/**
 * API tests: analyze-activity (Path A — per-activity AI analysis)
 *
 * Tier: @minor — runs in CI via `npm run test:api`.
 *
 * Two layers:
 *  1. Pure-helper unit tests (no network) — the privileged decision logic
 *     (idempotency / dual-source dedup / completeness, downsampling, sport
 *     bucketing, HR data-quality, completeness audit, JSON parsing). These
 *     are the real failure modes: a wrong skip decision silently drops or
 *     double-generates an analysis; a bad parser stores garbage.
 *  2. Live wiring smoke (@minor) — auth/method/CORS against the deployed
 *     endpoint. Generation + write-back is exercised end-to-end by the
 *     architect's post-deploy verification (a privileged write needs the
 *     real ANALYZE_ACTIVITY_SECRET + a seeded activity).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { config } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

import {
  sportOf,
  downsampleSamples,
  hrQuality,
  decideSkip,
  findDuplicateSibling,
  buildCompleteness,
  buildAnalysisPrompt,
  parseAnalysisJSON,
  coerceAnalysisShape,
  viennaDate,
} from '../../api/analyze-activity.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: join(__dirname, '../.env.test') })

const BASE = (process.env.VERCEL_DEPLOYMENT_URL ?? 'https://athlete-coach-alpha.vercel.app').replace(/\/$/, '')
const URL = `${BASE}/api/analyze-activity`

// ── Fixtures ──────────────────────────────────────────────────────────────────
function completeRun(extra = {}) {
  return {
    id: 1, user_id: 'u1', date: '2026-06-09T07:30:00.000Z', type: 'run',
    workout_type: null, distance_km: 10, duration_min: 55, avg_hr: 142, max_hr: 168,
    avg_cadence: 178, elevation_m: 60, pace_per_km: '5:30', splits_metric: [{ idx: 1 }],
    splits_source: 'strava', zone_data: null, enrichment_status: 'complete',
    rpe: 3, feel_legs: null, injury_flag: null, coach_analysis: null, coach_analysis_version: null,
    ...extra,
  }
}
const RUN_STREAMS = {
  zone_seconds: { z1: 300, z2: 2400, z3: 480, z4: 60, z5: 0 },
  cadence_stats: { avg: 178 }, grade_correlation: null,
  samples: Array.from({ length: 420 }, (_, i) => ({ t: i * 3, hr: 130 + (i % 30), vel: 3.0, alt: 100 + (i % 10), cad: 178 })),
}

// ── sportOf ─────────────────────────────────────────────────────────────────
test('@minor sportOf buckets multi-sport types', () => {
  assert.equal(sportOf({ type: 'Run' }), 'run')
  assert.equal(sportOf({ type: 'TrailRun' }), 'run')
  assert.equal(sportOf({ type: 'Ride' }), 'ride')
  assert.equal(sportOf({ type: 'VirtualRide' }), 'ride')
  assert.equal(sportOf({ type: 'WeightTraining' }), 'strength')
  assert.equal(sportOf({ type: 'Swim' }), 'swim')
  assert.equal(sportOf({ type: 'Hike' }), 'hike')
  assert.equal(sportOf({ type: 'Rowing' }), 'row')
  assert.equal(sportOf({ type: 'Yoga' }), 'other')
})

// ── downsampleSamples ───────────────────────────────────────────────────────
test('@minor downsampleSamples caps points and drops lat/lng', () => {
  const out = downsampleSamples(RUN_STREAMS.samples, 140)
  assert.ok(out.length <= 140, `expected <=140 got ${out.length}`)
  assert.ok(out.length >= 130, 'should be close to target')
  assert.equal(out[0].lat, undefined)
  assert.equal(out[0].lng, undefined)
  assert.ok('hr' in out[0] && 't' in out[0])
})
test('@minor downsampleSamples passes short streams through', () => {
  const short = RUN_STREAMS.samples.slice(0, 50)
  assert.equal(downsampleSamples(short, 140).length, 50)
  assert.equal(downsampleSamples([], 140).length, 0)
})

// ── hrQuality ───────────────────────────────────────────────────────────────
test('@minor hrQuality flags implausible Z5-dominant profile', () => {
  assert.equal(hrQuality({ zoneSeconds: { z1: 0, z2: 0, z3: 0, z4: 100, z5: 900 }, avgHr: 150, maxHr: 200 }), 'suspect')
  assert.equal(hrQuality({ zoneSeconds: RUN_STREAMS.zone_seconds, avgHr: 142, maxHr: 168 }), 'ok')
  assert.equal(hrQuality({ zoneSeconds: { z2: 1000 }, avgHr: 120, maxHr: 200 }), 'suspect') // 80bpm spread
})

// ── decideSkip ──────────────────────────────────────────────────────────────
test('@minor decideSkip: exists when analysis present and not forced', () => {
  const r = decideSkip({ activity: completeRun({ coach_analysis: { headline: 'x' } }), hasSamples: true, hasSplits: true, sibling: null, force: false })
  assert.deepEqual(r, { skip: true, reason: 'exists' })
})
test('@minor decideSkip: force overrides exists', () => {
  const r = decideSkip({ activity: completeRun({ coach_analysis: { headline: 'x' } }), hasSamples: true, hasSplits: true, sibling: null, force: true })
  assert.equal(r.skip, false)
})
test('@minor decideSkip: incomplete when not enriched', () => {
  const r = decideSkip({ activity: completeRun({ enrichment_status: 'pending' }), hasSamples: true, hasSplits: true, sibling: null, force: false })
  assert.deepEqual(r, { skip: true, reason: 'incomplete' })
})
test('@minor decideSkip: incomplete when no streams AND no splits', () => {
  const r = decideSkip({ activity: completeRun(), hasSamples: false, hasSplits: false, sibling: null, force: false })
  assert.deepEqual(r, { skip: true, reason: 'incomplete' })
})
test('@minor decideSkip: splits-only is sufficient (e.g. strength/manual)', () => {
  const r = decideSkip({ activity: completeRun(), hasSamples: false, hasSplits: true, sibling: null, force: false })
  assert.equal(r.skip, false)
})
test('@minor decideSkip: dup when a sibling already analysed', () => {
  const r = decideSkip({ activity: completeRun(), hasSamples: true, hasSplits: true, sibling: { id: 2 }, force: false })
  assert.deepEqual(r, { skip: true, reason: 'dup' })
})
test('@minor decideSkip: proceeds for a fresh complete activity', () => {
  const r = decideSkip({ activity: completeRun(), hasSamples: true, hasSplits: true, sibling: null, force: false })
  assert.deepEqual(r, { skip: false, reason: null })
})

// ── findDuplicateSibling (dual-source guard) ────────────────────────────────
test('@minor findDuplicateSibling matches same-day same-shape analysed row', () => {
  const act = completeRun()
  const candidates = [
    { id: 2, date: '2026-06-09T07:35:00.000Z', distance_km: 10.05, duration_min: 54, coach_analysis: { headline: 'done' } },
  ]
  assert.equal(findDuplicateSibling(act, candidates)?.id, 2)
})
test('@minor findDuplicateSibling ignores rows without an analysis', () => {
  const act = completeRun()
  const candidates = [{ id: 2, date: '2026-06-09T07:35:00.000Z', distance_km: 10, duration_min: 55, coach_analysis: null }]
  assert.equal(findDuplicateSibling(act, candidates), null)
})
test('@minor findDuplicateSibling ignores different distance', () => {
  const act = completeRun()
  const candidates = [{ id: 2, date: '2026-06-09T07:35:00.000Z', distance_km: 21, duration_min: 55, coach_analysis: { headline: 'x' } }]
  assert.equal(findDuplicateSibling(act, candidates), null)
})
test('@minor findDuplicateSibling ignores a different Vienna day', () => {
  const act = completeRun()
  const candidates = [{ id: 2, date: '2026-06-10T07:30:00.000Z', distance_km: 10, duration_min: 55, coach_analysis: { headline: 'x' } }]
  assert.equal(findDuplicateSibling(act, candidates), null)
})

// ── buildCompleteness ───────────────────────────────────────────────────────
test('@minor buildCompleteness: full run has empty-ish not_available', () => {
  const c = buildCompleteness({ activity: completeRun(), sport: 'run', streams: RUN_STREAMS, splits: [{ idx: 1 }], plannedSession: { name: 'Easy' }, trend: [] })
  assert.equal(c.has_hr, true)
  assert.equal(c.has_zone_data, true)
  assert.equal(c.has_splits, true)
  assert.equal(c.has_planned_session, true)
  assert.ok(!c.not_available.includes('hr_zones'))
  assert.ok(!c.not_available.includes('rpe')) // rpe=3 present
  assert.equal(c.prompt_version, 'analyze-activity@v1.1')
})
test('@minor buildCompleteness: missing channels land in not_available', () => {
  const bare = completeRun({ avg_hr: null, max_hr: null, avg_cadence: null, pace_per_km: null, elevation_m: null, splits_metric: null, rpe: null })
  const c = buildCompleteness({ activity: bare, sport: 'run', streams: null, splits: null, plannedSession: null, trend: [] })
  for (const m of ['hr_zones', 'pace', 'cadence', 'elevation', 'splits', 'rpe']) {
    assert.ok(c.not_available.includes(m), `expected ${m} in not_available`)
  }
  assert.equal(c.has_planned_session, false)
})
test('@minor buildCompleteness: ride always declares power not available', () => {
  const ride = completeRun({ type: 'Ride' })
  const c = buildCompleteness({ activity: ride, sport: 'ride', streams: RUN_STREAMS, splits: null, plannedSession: null, trend: [] })
  assert.ok(c.not_available.includes('power'))
  assert.ok(c.not_available.includes('intensity_factor'))
  assert.equal(c.has_power, false)
})
test('@minor buildCompleteness: data-rich activity (id-333 shape) reports has_rpe=true, rpe not in not_available', () => {
  // The exact regression: subjective RPE silently dropped → "not available".
  const rich = completeRun({ rpe: 2, feel: 'normal', feel_legs: 'normal' })
  const c = buildCompleteness({ activity: rich, sport: 'run', streams: RUN_STREAMS, splits: [{ idx: 1 }], plannedSession: { name: 'Easy' }, trend: [], injuries: [] })
  assert.equal(c.has_rpe, true)
  assert.equal(c.rpe_value, 2)
  assert.ok(!c.not_available.includes('rpe'), "'rpe' must NOT be in not_available when rpe is present")
  assert.equal(c.has_feel, true)
  assert.equal(c.has_feel_legs, true)
})
test('@minor buildCompleteness: active injuries audited (status-based, regardless of follow-up date)', () => {
  const injuries = [{ body_location: 'calf_left', severity: 'moderate', status: 'active', follow_up_due_date: '2026-04-29', follow_up_overdue: true }]
  const c = buildCompleteness({ activity: completeRun(), sport: 'run', streams: RUN_STREAMS, splits: null, plannedSession: null, trend: [], injuries })
  assert.equal(c.has_active_injuries, true)
  assert.equal(c.active_injury_count, 1)
})

// ── buildAnalysisPrompt ─────────────────────────────────────────────────────
test('@minor buildAnalysisPrompt: names NOT AVAILABLE metrics and forbids fabrication', () => {
  const bare = completeRun({ avg_hr: null, max_hr: null, pace_per_km: null, rpe: null })
  const comp = buildCompleteness({ activity: bare, sport: 'run', streams: null, splits: null, plannedSession: null, trend: [] })
  const { system, user } = buildAnalysisPrompt({ activity: bare, sport: 'run', streams: null, splits: null, plannedSession: null, settings: null, sports: [], trend: [], completeness: comp })
  assert.match(system, /NEVER FABRICATE/)
  assert.match(system, /NOT AVAILABLE/)
  assert.match(system, /TAG MISMATCH/)
  assert.match(system, /Output ONLY a single complete, valid JSON object/)
  assert.match(system, /<= 90 chars/) // brevity caps bound the output size
  assert.ok(user.includes('not_available') || user.includes('DATA COMPLETENESS'))
  // Truncation fix: send aggregates, NOT 140 raw stream samples.
  assert.ok(!user.includes('DOWNSAMPLED STREAM'), 'raw per-sample stream must not be sent to the model')
  assert.match(user, /HR ZONE DISTRIBUTION/)
})
test('@minor buildAnalysisPrompt: ride prompt forbids power', () => {
  const ride = completeRun({ type: 'Ride' })
  const comp = buildCompleteness({ activity: ride, sport: 'ride', streams: RUN_STREAMS, splits: null, plannedSession: null, trend: [] })
  const { system } = buildAnalysisPrompt({ activity: ride, sport: 'ride', streams: RUN_STREAMS, splits: null, plannedSession: null, settings: null, sports: [], trend: [], completeness: comp })
  assert.match(system, /NO power meter|do not reference power/i)
})
test('@minor buildAnalysisPrompt: suspect HR triggers the data-quality guard', () => {
  const act = completeRun({ avg_hr: 150, max_hr: 205 })
  const badStreams = { ...RUN_STREAMS, zone_seconds: { z1: 0, z2: 0, z3: 0, z4: 100, z5: 900 } }
  const comp = buildCompleteness({ activity: act, sport: 'run', streams: badStreams, splits: null, plannedSession: null, trend: [] })
  assert.equal(comp.hr_quality, 'suspect')
  const { system } = buildAnalysisPrompt({ activity: act, sport: 'run', streams: badStreams, splits: null, plannedSession: null, settings: null, sports: [], trend: [], completeness: comp })
  assert.match(system, /HR DATA QUALITY|low confidence/i)
})
test('@minor buildAnalysisPrompt: surfaces active injuries + raw RPE/feel, with INJURY-AWARE rule', () => {
  const act = completeRun({ rpe: 2, feel: 'normal', feel_legs: 'normal' })
  const injuries = [{ body_location: 'calf_left', severity: 'moderate', status: 'active', follow_up_due_date: '2026-04-29', follow_up_overdue: true }]
  const comp = buildCompleteness({ activity: act, sport: 'run', streams: RUN_STREAMS, splits: null, plannedSession: { name: 'Easy', zone: 'z2' }, trend: [], injuries })
  const { system, user } = buildAnalysisPrompt({ activity: act, sport: 'run', streams: RUN_STREAMS, splits: null, plannedSession: { name: 'Easy', zone: 'z2' }, settings: null, sports: [], trend: [], injuries, completeness: comp })
  assert.match(system, /INJURY-AWARE/)
  assert.match(system, /RAW RPE/)
  assert.match(user, /ACTIVE INJURIES/)
  assert.match(user, /calf_left/)
  assert.match(user, /follow_up_overdue/)
  // raw subjective passed through, no computed score
  assert.match(user, /"rpe":2/)
  assert.match(user, /"feel":"normal"/)
})
test('@minor buildAnalysisPrompt: no injuries → "none active", never invents one', () => {
  const comp = buildCompleteness({ activity: completeRun(), sport: 'run', streams: RUN_STREAMS, splits: null, plannedSession: null, trend: [], injuries: [] })
  const { user } = buildAnalysisPrompt({ activity: completeRun(), sport: 'run', streams: RUN_STREAMS, splits: null, plannedSession: null, settings: null, sports: [], trend: [], injuries: [], completeness: comp })
  assert.match(user, /ACTIVE INJURIES[^\n]*\nnone active/)
})

// ── parseAnalysisJSON / coerceAnalysisShape ─────────────────────────────────
const VALID = JSON.stringify({
  headline: 'Solid Z2 base run, held the easy line',
  sport: 'run',
  execution_vs_plan: { planned_session: 'Easy 10k', verdict: 'as_planned', note: 'matched the easy intent' },
  effort_read: { primary_zone: 'z2', distribution_note: '40min Z2' },
  key_signals: [{ label: 'RPE', value: '3/10', read: 'good easy execution' }],
  flags: [],
  coach_note: 'Textbook easy run.',
})
test('@minor parseAnalysisJSON: parses clean JSON', () => {
  const r = parseAnalysisJSON(VALID)
  assert.equal(r.ok, true)
  assert.equal(r.value.execution_vs_plan.verdict, 'as_planned')
})
test('@minor parseAnalysisJSON: strips a markdown fence', () => {
  const r = parseAnalysisJSON('```json\n' + VALID + '\n```')
  assert.equal(r.ok, true)
})
test('@minor parseAnalysisJSON: extracts JSON from surrounding prose', () => {
  const r = parseAnalysisJSON('Here is the analysis:\n' + VALID + '\nHope that helps!')
  assert.equal(r.ok, true)
})
test('@minor parseAnalysisJSON: fails on garbage and on missing required fields', () => {
  assert.equal(parseAnalysisJSON('not json at all').ok, false)
  assert.equal(parseAnalysisJSON('{"sport":"run"}').ok, false) // no headline/coach_note
  assert.equal(parseAnalysisJSON('').ok, false)
})
test('@minor coerceAnalysisShape: normalises partial objects to the contract', () => {
  const c = coerceAnalysisShape({ headline: 'x'.repeat(200), coach_note: 'note', flags: [{ type: 't', severity: 'bogus', message: 'm' }] })
  assert.equal(c.headline.length, 90) // clamped
  assert.equal(c.execution_vs_plan.verdict, 'no_plan')
  assert.equal(c.effort_read.primary_zone, 'n/a')
  assert.equal(c.flags[0].severity, 'info') // bogus → info
  assert.ok(Array.isArray(c.key_signals))
})

// ── viennaDate ──────────────────────────────────────────────────────────────
test('@minor viennaDate returns Vienna calendar day, not UTC', () => {
  // 22:30 UTC on the 9th is already the 10th in Vienna (UTC+2 summer).
  assert.equal(viennaDate('2026-06-09T22:30:00.000Z'), '2026-06-10')
  assert.equal(viennaDate('2026-06-09T07:30:00.000Z'), '2026-06-09')
})

// ── Live wiring smoke (@minor) ──────────────────────────────────────────────
test('@minor analyze-activity: GET returns 405', async () => {
  const res = await fetch(URL, { method: 'GET' })
  assert.equal(res.status, 405)
})
test('@minor analyze-activity: OPTIONS preflight returns 200', async () => {
  const res = await fetch(URL, { method: 'OPTIONS' })
  assert.ok(res.status === 200 || res.status === 204)
})
test('@minor analyze-activity: POST without secret is rejected 401', async () => {
  const res = await fetch(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ activity_id: 999999999 }),
  })
  assert.equal(res.status, 401, 'privileged write endpoint must reject a missing/incorrect secret')
})
test('@minor analyze-activity: CORS header present', async () => {
  const res = await fetch(URL, { method: 'OPTIONS' })
  assert.ok(res.headers.get('access-control-allow-origin'))
})
