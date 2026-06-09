/**
 * AI Eval: analyze-activity coach_analysis — fabrication detector
 *
 * In the spirit of detect_briefing_hallucinations(): this exercises the REAL
 * prompt the endpoint sends (imported from api/analyze-activity.js — no drift)
 * against hand-built fixtures, generates the structured coach_analysis with
 * Haiku, then asserts — both programmatically and with a Sonnet judge — that:
 *   1. the model makes NO claim about any metric listed NOT AVAILABLE,
 *   2. it reads the planned session into execution_vs_plan,
 *   3. it does NOT invent splits or HR zones,
 *   4. it FLAGS the tag-mismatch on a Z2-run-tagged-tempo fixture.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=... node tests/ai-eval/analyze-activity-eval.js
 * Exits 1 on any CRITICAL failure.
 */

import Anthropic from '@anthropic-ai/sdk'
import { config } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

import {
  sportOf,
  buildCompleteness,
  buildAnalysisPrompt,
  parseAnalysisJSON,
} from '../../api/analyze-activity.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: join(__dirname, '../.env.test') })

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ERROR: ANTHROPIC_API_KEY is not set')
  process.exit(1)
}
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ── Fixtures ──────────────────────────────────────────────────────────────────
// 1. Easy Z2 run with NO HR/zone/cadence data and NO splits — exercises the
//    NOT AVAILABLE boundary (the f76506ac bug class: don't invent zones/splits).
const FIX_MISSING = {
  label: 'easy_run_missing_hr_and_splits',
  activity: {
    id: 101, user_id: 'u', date: '2026-06-08T06:30:00.000Z', name: 'Morning Run',
    type: 'Run', workout_type: null, distance_km: 8.2, duration_min: 47,
    avg_hr: null, max_hr: null, avg_cadence: null, elevation_m: null, pace_per_km: '5:44',
    splits_metric: null, splits_source: null, zone_data: null, enrichment_status: 'complete',
    rpe: 3, feel_legs: 'fresh', injury_flag: null,
  },
  streams: null,
  plannedSession: { name: 'Easy Aerobic', session_type: 'easy', zone: 'z2', duration_min_low: 40, duration_min_high: 50 },
  // No HR stream → the model must not assert a measured primary zone, and must
  // not cite a specific bpm/spm value. (Referencing the PLANNED z2, or saying
  // "no cadence data", is correct — so we guard numbers/assertions, not words.)
  na_includes_hr: true,
  forbidden_value_patterns: [/\d+\s*bpm/i, /\d+\s*spm/i, /\bavg\s*hr[:\s]+\d/i],
  expect_tag_mismatch: false,
}

// 2. Tempo-TAGGED session executed as a pure Z2 easy run — must be flagged.
const FIX_TAGMISMATCH = {
  label: 'tempo_tagged_executed_as_z2',
  activity: {
    id: 102, user_id: 'u', date: '2026-06-07T16:00:00.000Z', name: 'Tempo Run',
    type: 'Run', workout_type: 'tempo', distance_km: 10, duration_min: 62,
    avg_hr: 131, max_hr: 142, avg_cadence: 172, elevation_m: 25, pace_per_km: '6:12',
    splits_metric: [{ idx: 1, distance_m: 1000, moving_time_s: 372, avg_speed_mps: 2.69, avg_hr: 129, avg_cadence_spm: 171, elev_change_m: 2 }],
    splits_source: 'strava', zone_data: null, enrichment_status: 'complete',
    rpe: 3, feel_legs: 'easy', injury_flag: null,
  },
  streams: {
    zone_seconds: { z1: 600, z2: 3000, z3: 120, z4: 0, z5: 0 }, // ~95% Z1-Z2 → NOT a tempo
    cadence_stats: { avg: 172 }, grade_correlation: null,
    samples: Array.from({ length: 200 }, (_, i) => ({ t: i * 18, hr: 128 + (i % 8), vel: 2.69, alt: 100, cad: 172 })),
  },
  plannedSession: { name: 'Tempo 4x8min', session_type: 'tempo', zone: 'z3', duration_min_low: 55, duration_min_high: 65 },
  na_includes_hr: false,
  forbidden_value_patterns: [],
  expect_tag_mismatch: true,
}

// 3. DATA-RICH activity (the id-333 truncation scenario): HR zones + 14 splits
//    + streams + planned session. The full structured JSON for this MUST fit the
//    token budget and parse — this is exactly the case that returned
//    parse_failed before max_tokens was raised + the input trimmed to aggregates.
const FIX_DATARICH = {
  label: 'data_rich_full_metrics_no_truncation',
  activity: {
    id: 333, user_id: 'u', date: '2026-06-06T06:30:00.000Z', name: 'Long Run',
    type: 'Run', workout_type: 'long_run', distance_km: 14.2, duration_min: 82,
    avg_hr: 148, max_hr: 169, avg_cadence: 176, elevation_m: 210, pace_per_km: '5:46',
    splits_metric: Array.from({ length: 14 }, (_, i) => ({
      idx: i + 1, distance_m: 1000, moving_time_s: 340 + (i % 5) * 6,
      avg_speed_mps: 1000 / (340 + (i % 5) * 6), avg_hr: 142 + (i % 7),
      avg_cadence_spm: 176, elev_change_m: (i % 3) * 8 - 6,
    })),
    splits_source: 'strava', zone_data: null, enrichment_status: 'complete',
    rpe: 5, feel_legs: 'solid', injury_flag: null,
  },
  streams: {
    zone_seconds: { z1: 480, z2: 2700, z3: 1500, z4: 240, z5: 0 },
    cadence_stats: { avg: 176, trend: [174, 175, 176, 177, 176] },
    grade_correlation: { correlation: -0.42 },
    samples: Array.from({ length: 424 }, (_, i) => ({ t: i * 12, hr: 140 + (i % 25), vel: 2.9, alt: 100 + (i % 40), cad: 176 })),
  },
  plannedSession: { name: 'Long Run 80min', session_type: 'long_run', zone: 'z2', duration_min_low: 75, duration_min_high: 90 },
  na_includes_hr: false,
  forbidden_value_patterns: [],
  expect_tag_mismatch: false,
  require_complete_keys: true, // must parse to a complete object (truncation regression guard)
}

const FIXTURES = [FIX_MISSING, FIX_TAGMISMATCH, FIX_DATARICH]
const REQUIRED_KEYS = ['headline', 'sport', 'execution_vs_plan', 'effort_read', 'key_signals', 'flags', 'coach_note']

const JUDGE_SYSTEM = `You are a coaching-AI fabrication auditor. You are given a structured per-activity coach_analysis (JSON) plus the exact list of metrics that were NOT AVAILABLE for that activity and the planned session. Decide, strictly, whether the analysis fabricated anything.

Return ONLY valid JSON, no markdown:
{ "criteria": [ { "id": "string", "pass": true, "critical": true, "reason": "string" } ], "overall_pass": true }

overall_pass=false if ANY critical criterion fails. Be rigorous: a numeric or qualitative claim about a NOT AVAILABLE metric is a fabrication and must fail. Do not give benefit of the doubt.`

async function generate(fix) {
  const sport = sportOf(fix.activity)
  const completeness = buildCompleteness({
    activity: fix.activity, sport, streams: fix.streams,
    splits: Array.isArray(fix.activity.splits_metric) ? fix.activity.splits_metric : null,
    plannedSession: fix.plannedSession, trend: [],
  })
  const { system, user } = buildAnalysisPrompt({
    activity: fix.activity, sport, streams: fix.streams,
    splits: Array.isArray(fix.activity.splits_metric) ? fix.activity.splits_metric : null,
    plannedSession: fix.plannedSession, settings: null, sports: [], trend: [], completeness,
  })
  // Mirror the endpoint's generation exactly (max_tokens=2500 + "{" assistant
  // prefill) so this eval is a faithful regression test for the truncation fix.
  const resp = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001', max_tokens: 2500, system,
    messages: [
      { role: 'user', content: user },
      { role: 'assistant', content: '{' },
    ],
  })
  const cont = resp.content?.[0]?.text || ''
  const text = '{' + cont
  return { completeness, parsed: parseAnalysisJSON(text), raw: text }
}

async function judge(fix, completeness, analysis) {
  const userMessage = `NOT AVAILABLE metrics for this activity: ${JSON.stringify(completeness.not_available)}
Planned session: ${JSON.stringify(fix.plannedSession)}

coach_analysis produced:
${JSON.stringify(analysis, null, 2)}

Evaluate these criteria (return all, same ids):
- id: no_fabricated_metrics (critical): The analysis makes NO numeric or qualitative claim about any NOT AVAILABLE metric. (If hr_zones is NOT AVAILABLE, it must not describe zone distribution or bpm; if splits NOT AVAILABLE, it must not narrate per-km splits.)
- id: reads_planned_session (critical): execution_vs_plan references the planned session and gives a verdict consistent with it (not "no_plan" when a plan was supplied).
- id: no_invented_structure (critical): Does not invent splits, intervals, or zone times that were not in the data.
- id: grounded (non-critical): key_signals reference real values from the data.`

  const resp = await anthropic.messages.create({
    model: 'claude-sonnet-4-6', max_tokens: 1500, system: JUDGE_SYSTEM,
    messages: [{ role: 'user', content: userMessage }],
  })
  const text = resp.content?.[0]?.text || ''
  // Tolerate an accidental fence or prose preamble — extract the JSON object.
  let s = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
  if (s[0] !== '{') {
    const i = s.indexOf('{'); const j = s.lastIndexOf('}')
    if (i !== -1 && j > i) s = s.slice(i, j + 1)
  }
  try {
    return JSON.parse(s)
  } catch (e) {
    return { overall_pass: false, criteria: [{ id: 'judge_parse', pass: false, critical: true, reason: `judge JSON parse failed: ${e.message}` }] }
  }
}

function deterministicChecks(fix, analysis, completeness) {
  const checks = []
  const blob = JSON.stringify(analysis)

  // No measured-value fabrication: forbid a concrete bpm/spm/avgHR number when
  // that channel was NOT AVAILABLE. (Precise — does not false-positive on a
  // correct "no cadence data" statement or on a reference to the planned zone.)
  for (const re of fix.forbidden_value_patterns) {
    const hit = re.test(blob)
    checks.push({ id: `no_value_${re.source.slice(0, 10)}`, critical: true, pass: !hit, reason: hit ? `output asserts a concrete value /${re.source}/ for a NOT AVAILABLE channel` : 'ok' })
  }

  // With no HR stream, the model must not assert a measured primary training
  // zone — primary_zone must be "n/a" (referencing the planned zone in a note
  // is fine; claiming the athlete trained in a measured zone is fabrication).
  if (fix.na_includes_hr) {
    const pz = String(analysis.effort_read?.primary_zone ?? '').toLowerCase()
    const ok = pz === 'n/a' || pz === '' || pz === 'na'
    checks.push({ id: 'primary_zone_na_without_hr', critical: true, pass: ok, reason: ok ? 'primary_zone correctly n/a' : `asserted measured primary_zone "${pz}" with no HR data` })
  }

  // Data-rich activity must produce a COMPLETE object (no truncation): every
  // top-level key present. This is the id-333 regression guard.
  if (fix.require_complete_keys) {
    const missing = REQUIRED_KEYS.filter(k => !(k in analysis))
    checks.push({ id: 'complete_object_no_truncation', critical: true, pass: missing.length === 0, reason: missing.length === 0 ? 'all top-level keys present' : `missing keys: ${missing.join(', ')}` })
    // Subjective data must be LOADED, not dropped — the id-333 regression.
    const hasRpe = completeness?.has_rpe === true
    checks.push({ id: 'rpe_loaded_has_rpe_true', critical: true, pass: hasRpe, reason: hasRpe ? 'prompt_data_completeness.has_rpe=true' : `has_rpe should be true (fixture has rpe=${fix.activity.rpe}); got ${completeness?.has_rpe}` })
    checks.push({ id: 'rpe_not_in_not_available', critical: true, pass: !completeness?.not_available?.includes('rpe'), reason: completeness?.not_available?.includes('rpe') ? "'rpe' wrongly listed NOT AVAILABLE" : 'ok' })
  }

  // Tag-mismatch flag must be present for the tempo-tagged-Z2 fixture.
  if (fix.expect_tag_mismatch) {
    const flags = Array.isArray(analysis.flags) ? analysis.flags : []
    const found = flags.some(f => /tag.?mismatch/i.test(f.type || '') || /tag.?mismatch|tagged.*tempo|labelled.*tempo|not.*tempo|actually.*(easy|z2)/i.test(f.message || ''))
    checks.push({ id: 'tag_mismatch_flagged', critical: true, pass: found, reason: found ? 'tag_mismatch surfaced' : `expected a tag-mismatch flag; got flags=${JSON.stringify(flags)}` })
  }
  return checks
}

async function run() {
  console.log('═══════════════════════════════════════════════════════')
  console.log('AI Eval: analyze-activity fabrication detector')
  console.log('═══════════════════════════════════════════════════════')
  let overall = true

  for (const fix of FIXTURES) {
    console.log(`\n▶ Fixture: ${fix.label}`)
    let gen
    try {
      gen = await generate(fix)
    } catch (e) {
      console.log(`  ✗ generation failed: ${e.message}`)
      overall = false
      continue
    }
    if (!gen.parsed.ok) {
      console.log(`  ❌ CRITICAL: model output did not parse to coach_analysis shape: ${gen.parsed.error}`)
      console.log(`     raw: ${gen.raw.slice(0, 200)}`)
      overall = false
      continue
    }
    const analysis = gen.parsed.value
    console.log(`  headline: ${analysis.headline}`)

    const det = deterministicChecks(fix, analysis, gen.completeness)
    const judged = await judge(fix, gen.completeness, analysis)
    const all = [...det, ...(judged.criteria || [])]

    for (const c of all) {
      const tag = c.critical ? '[CRITICAL]' : '[minor]'
      const mark = c.pass ? '✅' : (c.critical ? '❌' : '⚠')
      console.log(`  ${mark} ${tag} ${c.id}${c.pass ? '' : ` — ${c.reason}`}`)
      if (c.critical && !c.pass) overall = false
    }
  }

  console.log('\n═══════════════════════════════════════════════════════')
  console.log(`RESULT: ${overall ? '✅ PASS' : '❌ FAIL'}`)
  console.log('═══════════════════════════════════════════════════════')
  if (!overall) process.exit(1)
}

run().catch(err => { console.error('Unexpected eval error:', err); process.exit(1) })
