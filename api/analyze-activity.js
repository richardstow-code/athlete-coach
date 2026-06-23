// analyze-activity.js — Path A: automatic per-activity AI coaching analysis.
//
// When an activity finishes enrichment (activities.enrichment_status ->
// 'complete'), a DB trigger fires pg_net POST { activity_id } at this
// endpoint with the x-analyze-secret header (STEP 4, owned by the
// architect — fire-and-forget, does NOT await the LLM). This endpoint
// reads the FULL detailed activity data (streams, splits, zones,
// cadence/power), assembles the athlete-state snapshot INLINE from base
// tables with the service role, asks Haiku for a STRICT-JSON multi-sport
// coaching read, and writes the structured result back onto the activity
// (activities.coach_analysis + audit columns).
//
// This is the productised fix for feature_request f76506ac: buildContext
// feeds the coach SUMMARY-ONLY activity data and never queries
// activity_streams / splits_metric, so a detailed per-activity read was
// previously only obtainable by opening a chat. Path A generates it once,
// server-side, and stores it.
//
// Config / Anthropic call path mirrors api/claude-proxy.js (raw fetch,
// process.env.SUPABASE_SECRET_KEY + process.env.ANTHROPIC_API_KEY). The
// privileged decision logic (idempotency / dual-source dedup / completeness,
// downsampling, prompt assembly, JSON parsing) is factored into exported
// pure helpers so it is unit-testable without a seeded DB.

export const config = { maxDuration: 60 };

const SUPABASE_URL = 'https://yjuhzmknabedjklsgbje.supabase.co';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const TZ = 'Europe/Vienna';

// ── HTTP plumbing ────────────────────────────────────────────────────
function corsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, x-analyze-secret');
}

function svcHeaders(extra) {
  return {
    apikey: process.env.SUPABASE_SECRET_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SECRET_KEY}`,
    ...(extra || {}),
  };
}

// GET against PostgREST — returns parsed array (or [] on error).
async function restGet(pathAndQuery) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    headers: svcHeaders(),
  });
  if (!resp.ok) return [];
  try { return await resp.json(); } catch { return []; }
}

// PATCH a row set on PostgREST. Returns the HTTP status.
async function restPatch(table, query, body) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    method: 'PATCH',
    headers: svcHeaders({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
    body: JSON.stringify(body),
  });
  return resp.status;
}

async function callAnthropic({ model, max_tokens, system, messages }) {
  const resp = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': ANTHROPIC_VERSION,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model, max_tokens, system, messages }),
  });
  let data = null;
  try { data = await resp.json(); } catch {}
  return { httpStatus: resp.status, data };
}

// ── Pure helpers (exported for tests) ────────────────────────────────

// Vienna calendar date (YYYY-MM-DD). NEVER toISOString() for date compares.
export function viennaDate(d) {
  return new Date(d).toLocaleDateString('en-CA', { timeZone: TZ });
}

// Coarse sport bucket from the activity type/workout_type. Sport-agnostic
// downstream — drives which channels the prompt is allowed to reference.
export function sportOf(activity) {
  const t = `${activity?.type ?? ''} ${activity?.workout_type ?? ''}`.toLowerCase();
  if (/swim/.test(t)) return 'swim';
  if (/ride|cycl|bike|virtualride|ebike/.test(t)) return 'ride';
  if (/strength|weight|gym|lift|crossfit/.test(t)) return 'strength';
  if (/row/.test(t)) return 'row';
  if (/hike|walk/.test(t)) return 'hike';
  if (/run|trail|jog/.test(t)) return 'run';
  return 'other';
}

// Run/walk/hike report ONE-FOOT (per-leg) cadence; true steps-per-minute is
// ×2. SAME set + helper semantics as enrich-activity v16 (computeCadenceStats)
// and lib/splits.ts (sportDoublesCadence) so analyze-activity, cadence_stats,
// and per-split cadence all agree. Ride/row/swim/strength keep raw rpm.
const CADENCE_DOUBLE_SPORTS = new Set([
  'run', 'running', 'trailrun', 'trail run', 'trail_run', 'walk', 'walking', 'hike', 'hiking',
]);
export function sportDoublesCadence(sportType) {
  return CADENCE_DOUBLE_SPORTS.has(String(sportType ?? '').trim().toLowerCase());
}

// The cadence value to present for THIS sport. activities.avg_cadence is stored
// RAW per-leg by the Strava import (strava-webhook.js — average_cadence), never
// doubled; enrich v16 only doubled cadence_stats. So double it HERE for
// run/walk/hike (→ steps-per-minute, ~170), leave ride/row rpm untouched.
// cadence_stats is already doubled upstream — do NOT double it again.
export function cadenceDisplayAvg(avgCadence, sport) {
  if (avgCadence == null) return null;
  return sportDoublesCadence(sport) ? Math.round(Number(avgCadence) * 2) : avgCadence;
}

// Evenly-spaced downsample of the sample stream to ~target points. Drops
// lat/lng (not needed for the read; saves tokens) and keeps t/hr/vel/alt/cad.
export function downsampleSamples(samples, target = 140) {
  if (!Array.isArray(samples) || samples.length === 0) return [];
  const slim = (s) => {
    const o = {};
    if (s.t != null) o.t = s.t;
    if (s.hr != null) o.hr = s.hr;
    if (s.vel != null) o.vel = Math.round(s.vel * 100) / 100;
    if (s.alt != null) o.alt = Math.round(s.alt);
    if (s.cad != null) o.cad = s.cad;
    return o;
  };
  if (samples.length <= target) return samples.map(slim);
  const step = samples.length / target;
  const out = [];
  for (let i = 0; i < target; i++) out.push(slim(samples[Math.floor(i * step)]));
  return out;
}

// Total seconds across z1..z5.
function zoneTotal(zs) {
  if (!zs) return 0;
  return ['z1', 'z2', 'z3', 'z4', 'z5'].reduce((s, k) => s + (Number(zs[k]) || 0), 0);
}

// HR data-quality heuristic. Chest-strap dropout falls back to optical wrist
// HR and produces implausible Z5 / spikes. Returns 'suspect' when the zone
// mix or HR spread looks like a sensor artefact rather than real effort.
export function hrQuality({ zoneSeconds, avgHr, maxHr }) {
  const total = zoneTotal(zoneSeconds);
  if (total > 0) {
    const z5share = (Number(zoneSeconds.z5) || 0) / total;
    // > half the session in Z5 is almost never a real continuous effort.
    if (z5share > 0.5) return 'suspect';
  }
  if (avgHr != null && maxHr != null && maxHr - avgHr > 70) return 'suspect';
  return 'ok';
}

// Decide whether to skip generation. Pure — all inputs passed in.
//   reason: 'exists'   — coach_analysis already present and not forced
//           'incomplete'— not enriched, or no streams-with-samples AND no splits
//           'dup'      — a duplicate-shaped sibling already has an analysis
// Returns { skip: boolean, reason: string|null }.
export function decideSkip({ activity, hasSamples, hasSplits, sibling, force }) {
  if (activity?.coach_analysis != null && force !== true) {
    return { skip: true, reason: 'exists' };
  }
  if (activity?.enrichment_status !== 'complete' || (!hasSamples && !hasSplits)) {
    return { skip: true, reason: 'incomplete' };
  }
  if (sibling != null) {
    return { skip: true, reason: 'dup' };
  }
  return { skip: false, reason: null };
}

// Find a duplicate-shaped sibling that already carries an analysis. The
// dual-source case: a native-recorded + Strava-synced run lands as TWO rows
// (same user, same Vienna day, ~same distance/duration). If a sibling is
// already analysed we must not generate twice for one real session.
export function findDuplicateSibling(activity, candidates) {
  const day = viennaDate(activity.date);
  const dist = Number(activity.distance_km);
  const dur = Number(activity.duration_min);
  for (const c of candidates || []) {
    if (c.id === activity.id) continue;
    if (c.coach_analysis == null) continue;
    if (viennaDate(c.date) !== day) continue;
    // distance within max(0.5km, 10%); duration within max(3min, 10%).
    if (Number.isFinite(dist) && Number.isFinite(Number(c.distance_km))) {
      const tol = Math.max(0.5, dist * 0.1);
      if (Math.abs(Number(c.distance_km) - dist) > tol) continue;
    }
    if (Number.isFinite(dur) && Number.isFinite(Number(c.duration_min))) {
      const tol = Math.max(3, dur * 0.1);
      if (Math.abs(Number(c.duration_min) - dur) > tol) continue;
    }
    return c;
  }
  return null;
}

// Build the data-completeness audit — the record of exactly which metrics
// were present vs NOT AVAILABLE for THIS activity. This is both the prompt's
// fabrication boundary and the testable artefact written to
// prompt_data_completeness.
export function buildCompleteness({ activity, sport, streams, splits, plannedSession, trend, injuries }) {
  const samples = Array.isArray(streams?.samples) ? streams.samples : [];
  const zoneSeconds = streams?.zone_seconds ?? activity?.zone_data ?? null;
  const has = {
    has_hr: activity?.avg_hr != null || samples.some(s => s.hr != null),
    has_zone_data: zoneTotal(zoneSeconds) > 0,
    has_cadence: activity?.avg_cadence != null || !!streams?.cadence_stats || samples.some(s => s.cad != null),
    has_pace: activity?.pace_per_km != null || samples.some(s => s.vel != null && s.vel > 0.1),
    has_elevation: activity?.elevation_m != null || samples.some(s => s.alt != null),
    has_splits: Array.isArray(splits) && splits.length > 0,
    has_streams: samples.length > 0,
    // No power channel exists in this schema today — rides have no power meter
    // data ingested. Declared explicitly so the prompt says so, never invents IF/W.
    has_power: false,
    has_grade_correlation: streams?.grade_correlation != null,
    has_planned_session: plannedSession != null,
    has_rpe: activity?.rpe != null,
    has_feel: activity?.feel != null,
    has_feel_legs: activity?.feel_legs != null,
    has_active_injuries: Array.isArray(injuries) && injuries.length > 0,
  };

  // NOT AVAILABLE list — channels the model must not reference for this sport.
  const not_available = [];
  if (!has.has_hr || !has.has_zone_data) not_available.push('hr_zones');
  if (!has.has_pace && (sport === 'run' || sport === 'hike' || sport === 'swim')) not_available.push('pace');
  if (!has.has_cadence) not_available.push('cadence');
  if (!has.has_elevation) not_available.push('elevation');
  if (!has.has_splits) not_available.push('splits');
  if (sport === 'ride') not_available.push('power', 'intensity_factor');
  if (!has.has_rpe) not_available.push('rpe');
  not_available.push('fuel'); // analyze-activity has no nutrition channel — never comment on fuelling

  return {
    prompt_version: SCHEMA_VERSION,
    sport,
    model: DEFAULT_MODEL,
    sample_count: samples.length,
    downsampled_count: Math.min(samples.length, 140),
    splits_source: activity?.splits_source ?? null,
    rpe_value: activity?.rpe ?? null,
    hr_quality: hrQuality({ zoneSeconds, avgHr: activity?.avg_hr, maxHr: activity?.max_hr }),
    trend_count: Array.isArray(trend) ? trend.length : 0,
    active_injury_count: Array.isArray(injuries) ? injuries.length : 0,
    ...has,
    not_available,
  };
}

// Schema/prompt version (card redesign). Stored in prompt_data_completeness; the
// PR #11 fingerprint guard (shouldSkipRegen) includes it, so a deploy regenerates
// any still-v1.1 card under the new schema on its next (re)invocation.
export const SCHEMA_VERSION = 'analyze-activity@v1.2.2';

// Pace formatter — speed (m/s) → "m:ss" per km, or null when unknown. NEVER feed
// decimal minutes to the model (the "5:73" bug); always mm:ss.
export function fmtPace(speed_mps) {
  if (!(speed_mps > 0)) return null;
  const s = Math.round(1000 / speed_mps); // sec per km
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// Qualitative grade-impact bucket from elevation + |grade_correlation|. The model
// only ever sees the bucket — never the raw coefficient (the "-0.183" method leak).
export function gradeImpactBucket(elevation_m, grade_correlation) {
  const r = Math.abs(Number(grade_correlation) || 0);
  const elev = Number(elevation_m) || 0;
  if (elev >= 150 || r >= 0.3) return 'significant';
  if (elev >= 60 || r >= 0.15) return 'moderate';
  return 'minimal';
}

// Assemble the multi-sport system + user prompt. Returns { system, user }.
// Follows the daily-briefing v12 / claude-proxy Coach's-Take framework:
// NEVER FABRICATE, raw RPE (no computed feel score), HR data-quality guard,
// explicit NOT AVAILABLE list, tag-mismatch surfacing.
export function buildAnalysisPrompt({ activity, sport, streams, splits, plannedSession, settings, sports, trend, injuries, completeness }) {
  const zoneSeconds = streams?.zone_seconds ?? activity?.zone_data ?? null;

  // Aggregate the streams into a compact summary instead of sending raw
  // per-sample points. 140 raw samples bloated the input and pushed the
  // model's JSON output past max_tokens (truncation → parse_failed). The
  // zone seconds / cadence / grade / splits aggregates carry the signal.
  const zTotal = ['z1', 'z2', 'z3', 'z4', 'z5'].reduce((s, k) => s + (Number(zoneSeconds?.[k]) || 0), 0);
  const zoneDistribution = zTotal > 0
    ? ['z1', 'z2', 'z3', 'z4', 'z5'].map(k => {
        const secs = Number(zoneSeconds?.[k]) || 0;
        return `${k}: ${Math.round(secs / 60)}min (${Math.round((secs / zTotal) * 100)}%)`;
      }).join(', ')
    : 'no HR-zone data';
  // Compact splits summary (idx / km / pace / hr) capped to keep input small.
  const splitsSummary = Array.isArray(splits)
    ? splits.slice(0, 16).map(s => {
        const km = (Number(s.distance_m) / 1000).toFixed(2);
        const pace = fmtPace(s.avg_speed_mps); // mm:ss — never decimal minutes
        return `#${s.idx}: ${km}km${pace ? ` @ ${pace}/km` : ''}${s.avg_hr != null ? `, HR ${s.avg_hr}` : ''}`;
      })
    : null;

  // Sport-specific channel guidance — only mention channels that exist.
  const SPORT_GUIDE = {
    run: 'Channels: pace, grade-adjusted pace (GAP) for hilly routes, HR zones, cadence, aerobic decoupling. Prefer GAP over raw pace when elevation is real.',
    hike: 'Channels: HR zones, elevation/effort, time-on-feet, cadence. Treat elevation as the primary load metric, not pace.',
    ride: 'Channels: HR, cadence. There is NO power meter data in this system — do not reference power, watts, NP, or IF. Say power was not recorded if relevant.',
    strength: 'Channels: sets/reps/load/RPE/volume and session duration. Do NOT narrate HR zones or aerobic-base language for strength work.',
    swim: 'Channels: pace per 100m, stroke, interval structure, HR if present.',
    row: 'Channels: effort, HR, duration, cadence/stroke rate if present.',
    other: 'Channels: generic effort, HR if present, duration. Keep the read general.',
  };

  const na = completeness.not_available;
  const naLine = na.length
    ? `NOT AVAILABLE for THIS activity: ${na.join(', ')}. You MUST NOT state, estimate, qualitatively describe, or invent any of these. Do not infer them from other channels.`
    : 'All expected channels for this sport are present.';

  const hrGuard = completeness.hr_quality === 'suspect'
    ? 'HR DATA QUALITY: the zone/HR profile looks like a sensor artefact (optical-wrist dropout or chest-strap glitch — implausible Z5 or HR spread). FLAG low confidence in any HR-zone read; do NOT assert the athlete trained at high intensity on this basis.'
    : '';

  const races = settings?.races ?? null;
  const nextRace = Array.isArray(races) ? races[0] : races;

  const system = `You are an elite multi-sport endurance & strength coach writing the per-activity analysis for ONE completed session. Sport: ${sport}.
${SPORT_GUIDE[sport] || SPORT_GUIDE.other}

ABSOLUTE RULES:
1. NEVER FABRICATE. ${naLine} Never assert a measured HR zone when HR-zone data is NOT AVAILABLE — you may reference the PLANNED zone, but never claim a measured zone the data lacks.
2. RAW RPE. Athlete RPE is raw 1-10 (NOT a feel score). Interpret against the planned intensity: low RPE on a planned easy/Z2 session is GOOD; high RPE on an easy session is a fatigue/heat/drift signal; low RPE on a planned hard session is under-execution. Never invert RPE into a valenced "feel".
3. ${hrGuard || 'Use only HR-zone values actually present in the data.'}
4. PLAN-FIRST. If a planned session is supplied, set verdict.plan_verdict by comparing actual zone/duration/intensity to it and put the planned brief in measured_against. If none, plan_verdict="no_plan" and measured_against=null.
5. TAG MISMATCH. If workout_type / the planned session implies intensity (tempo/threshold/interval/hard) but the effort was actually easy (Z1-Z2 / low RPE), surface a flag (type "tag_mismatch") AND set type_inference (e.g. "Logged easy; planned threshold — treating as a swap"). Never ask about it.
6. INJURY-AWARE. Only surface injuries present in the ACTIVE INJURIES input for THIS analysis — NEVER carry forward a previously-seen injury. If one is listed, acknowledge in one short clause how THIS session interacts with the area; an injury whose follow_up_overdue is true is the MOST important — surface it as a "warn" flag ("follow-up overdue since <date>"). Do not invent injuries.
7. SCOPE — ONE HOME PER FINDING. Every fact appears in exactly ONE field. verdict.call is the ONLY bottom-line statement AND is a SHORT QUALITATIVE judgement: one complete sentence ≤80 chars, plain language, with NO numbers and NO metric values (pace mm:ss, HR, zone %, RPE, duration) — those live ONLY in metric_blocks + summary. Good: "Easy Z2 run, executed exactly to plan." BAD: "68 min easy Z2 run at 5:32/km with HR 92% in Z2 and RPE 2, matching the…" (metric dump + dangling). A metric-specific finding (aerobic decoupling, HR drift, late surge, fade, cadence loss, etc.) lives in EXACTLY ONE place: its own metric_block annotation (HR findings — incl. decoupling/drift — go in the hr block ONLY). summary may sketch the overall session arc + plan context but MUST NOT restate any block's specific finding or repeat any annotation. Each annotation describes ONLY its own metric; never restate the verdict or summary. A flag may raise a finding INSTEAD of (never in addition to) its annotation.
8. NO META / NO QUESTIONS / NO INTERNAL TERMS. Never ask questions, never narrate method, never output raw statistics (r/p values, coefficients) or "Check:" clauses. NEVER name an internal mechanism or data artifact — banned: "bucket", "qualitative bucket", "correlation", "decoupling coefficient", "model", "schema", "fingerprint". State only the plain conclusion (terrain example: write "Flat route — terrain wasn't a factor", NOT "minimal grade impact as the qualitative bucket confirms"). Grade impact is supplied as a qualitative descriptor — express it as plain terrain language, never the mechanism, never a coefficient.
9. PACE FORMAT. Pace values are supplied pre-formatted as mm:ss. Reproduce them EXACTLY into canonical_value / session_line. NEVER compute or reformat a pace yourself.
10. FUEL. Do NOT comment on fuelling/hydration unless nutrition data for THIS session is provided (it is in the NOT AVAILABLE list when absent).
11. METRIC BLOCKS. Emit one metric_block per metric the data supports. canonical_value is the ONE headline number (pre-formatted; pace already mm:ss). session_line is a factual readout from the SAME artifact the graph draws from. annotation is MANDATORY and about THIS metric only; if data_available=false the annotation STATES the absence (never null, never a fabricated number). label is ≤3 words — use a standard abbreviation (RPE, HR, Pace, Cadence, Terrain, Power), never a long phrase. UNITS: cadence is reported in **spm** (steps per minute), NEVER bpm.
12. COMPLETE SENTENCES WITHIN CAPS. Every field must read as FINISHED prose that fits inside its character cap — plan each sentence to fit, do not write past the cap. A field must NEVER end mid-word or on a dangling clause (no "…thou", no "…cumulati"). flags[].message is a TERSE label-style note, not a sentence (e.g. "Aerobic decoupling, final 3 km"); severity drives display.

OUTPUT: Output ONLY a single complete, valid JSON object matching the schema below — no markdown, no code fence, no prose before or after. Do not wrap it in \`\`\`. Write complete sentences within every cap. Exactly this shape:
{
  "sport": "${sport}",
  "verdict": { "call": "string <= 80 — SHORT qualitative bottom-line, ONE complete sentence, NO numbers / NO metric values (pace/HR/zone%/RPE/duration)", "plan_verdict": "as_planned|easier|harder|off_plan|no_plan", "action": "string|null <= 140 — at most ONE next-step line" },
  "type_inference": "string|null <= 120 — only when logged type != planned type; else null",
  "summary": "string <= 450 — holistic session arc + plan context; MUST NOT repeat any annotation or a block's specific finding",
  "measured_against": "string|null — the planned-session brief (not a verdict restatement)",
  "metric_blocks": [ { "metric_key": "hr|pace|elevation|cadence|power|...", "label": "string <= 24, <=3 words / standard abbreviation (RPE, HR, Pace, Cadence, Terrain, Power)", "canonical_value": "string <= 24 (cadence in spm, never bpm)", "session_line": "string <= 120", "plan_line": "string|null <= 120", "annotation": "string <= 220 (MANDATORY, complete sentences)", "data_available": true } ],
  "flags": [ { "type": "string", "severity": "info|warn", "message": "string <= 120, terse label-style" } ]
}
metric_blocks: one per supported metric, any order (the app sorts by a fixed priority). flags: [] if nothing notable. Respect every cap and finish every sentence — a complete, well-scoped object matters more than verbosity.`;

  const user = `ACTIVITY (summary):
${JSON.stringify({
    name: activity.name, type: activity.type, workout_type: activity.workout_type,
    date_vienna: viennaDate(activity.date), distance_km: activity.distance_km,
    duration_min: activity.duration_min, avg_hr: activity.avg_hr, max_hr: activity.max_hr,
    avg_cadence: cadenceDisplayAvg(activity.avg_cadence, sport), elevation_m: activity.elevation_m, pace_per_km: activity.pace_per_km,
    rpe: activity.rpe ?? null, feel: activity.feel ?? null, feel_legs: activity.feel_legs ?? null, injury_flag: activity.injury_flag ?? null,
  })}

HR ZONE DISTRIBUTION: ${zoneDistribution}
CADENCE STATS (avg + 5-seg trend): ${JSON.stringify(streams?.cadence_stats ?? null)}
GRADE IMPACT (express as plain terrain language — NEVER name a "bucket"/mechanism, NEVER a coefficient): ${gradeImpactBucket(activity.elevation_m, streams?.grade_correlation)}
SPLITS (${activity.splits_source ?? 'none'}): ${splitsSummary ? splitsSummary.join(' | ') : 'none'}

PLANNED SESSION for ${viennaDate(activity.date)} (null = off-plan / unplanned):
${JSON.stringify(plannedSession)}

ACTIVE INJURIES (status=active — present regardless of follow-up date; follow_up_overdue=true means the follow-up is past due):
${Array.isArray(injuries) && injuries.length
    ? JSON.stringify(injuries.map(i => ({ area: i.body_location, severity: i.severity, follow_up_due: i.follow_up_due_date ?? null, follow_up_overdue: !!i.follow_up_overdue })))
    : 'none active'}

ATHLETE: goal=${JSON.stringify(settings?.goal_type ?? null)} level=${JSON.stringify(settings?.current_level ?? null)} next_race=${JSON.stringify(nextRace ?? null)} sports=${JSON.stringify((sports || []).map(s => ({ sport: s.sport_raw, priority: s.priority })))}
HR ZONES (config): ${JSON.stringify(settings?.hr_zones ?? null)}

LAST ${Array.isArray(trend) ? trend.length : 0} SAME-SPORT ACTIVITIES (trend — decoupling/cadence/pace context):
${JSON.stringify((trend || []).map(a => ({ date: viennaDate(a.date), distance_km: a.distance_km, duration_min: a.duration_min, avg_hr: a.avg_hr, pace_per_km: a.pace_per_km })))}

DATA COMPLETENESS (authoritative — anything in not_available is off-limits): ${JSON.stringify(completeness.not_available)}

Write the analysis as STRICT JSON now.`;

  return { system, user };
}

// Parse the model output into the coach_analysis object. Tolerates an
// accidental code fence / leading prose. Returns { ok, value } or { ok:false, error }.
export function parseAnalysisJSON(text) {
  if (!text || typeof text !== 'string') return { ok: false, error: 'empty model output' };
  const s = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  // Try a direct parse first; if that fails (leading/trailing prose, stray
  // fence, or trailing tokens after the object), extract the outermost {...}.
  const tryParse = (str) => { try { return { obj: JSON.parse(str) }; } catch (e) { return { err: e.message }; } };
  let res = tryParse(s);
  if (res.err) {
    const i = s.indexOf('{');
    const j = s.lastIndexOf('}');
    if (i === -1 || j <= i) return { ok: false, error: `JSON.parse failed: ${res.err}` };
    res = tryParse(s.slice(i, j + 1));
    if (res.err) return { ok: false, error: `JSON.parse failed: ${res.err}` };
  }
  const obj = res.obj;
  if (!obj || typeof obj !== 'object') return { ok: false, error: 'parsed value is not an object' };
  if (!obj.verdict || typeof obj.verdict.call !== 'string' || typeof obj.summary !== 'string') {
    return { ok: false, error: 'missing required verdict.call/summary' };
  }
  return { ok: true, value: coerceAnalysisShape(obj) };
}

const PLAN_VERDICTS = ['as_planned', 'easier', 'harder', 'off_plan', 'no_plan'];

// Boundary-safe length clamp (post-build fix 1.A): NEVER cut a coaching field
// mid-word. The prompt instructs the model to write complete sentences within
// each cap; this is the safety net if a field still overruns. Trim to the last
// sentence end within the cap (when it isn't pathologically short), else the last
// word boundary, stripping any dangling clause punctuation. The result always
// ends on a complete word / sentence — never a partial token like "cumulati".
// Function words that must never be the LAST token of a trimmed field (the
// "…matching the", "…and no" dangling-clause bug, v1.2.2 fix 2.B).
const DANGLING_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'with', 'in', 'for', 'at', 'on',
  'that', 'while', 'despite', 'as', 'but', 'by', 'from', 'into', 'than', 'then',
  'its', 'their', 'his', 'her', 'this', 'no',
]);

export function clampText(s, max) {
  const str = String(s ?? '').trim();
  if (str.length <= max) return str;
  const slice = str.slice(0, max);
  // 1) PREFER the last sentence terminator (. ! ?) at/under the cap — cut there.
  let se = -1;
  for (let i = 0; i < slice.length; i++) {
    if (/[.!?]/.test(slice[i]) && (i + 1 >= slice.length || /\s/.test(slice[i + 1]))) se = i;
  }
  if (se >= Math.floor(max * 0.5)) return slice.slice(0, se + 1).trim();
  // 2) No usable terminator (a single over-long sentence) → trim at the last word
  //    boundary, then strip any trailing dangling function word(s) so we never end
  //    on a hanging word ("…matching the" → "…matching").
  const sp = slice.lastIndexOf(' ');
  let words = (sp > 0 ? slice.slice(0, sp) : slice).replace(/[\s,;:—–-]+$/, '').trim().split(/\s+/);
  while (words.length > 1 && DANGLING_WORDS.has(words[words.length - 1].toLowerCase().replace(/[^a-z]/g, ''))) {
    words.pop();
  }
  let base = words.join(' ').replace(/[\s,;:—–-]+$/, '').trim();
  // 3) Still a mid-clause fragment (no terminal punctuation) with a short trailing
  //    tail after the last comma → drop back to that comma ("…RPE 2, matching" → "…RPE 2").
  if (!/[.!?]$/.test(base)) {
    const comma = base.lastIndexOf(',');
    if (comma > 0) {
      const trailing = base.slice(comma + 1).trim().split(/\s+/).filter(Boolean);
      if (trailing.length <= 4) base = base.slice(0, comma);
    }
  }
  return base.replace(/[\s,;:—–-]+$/, '').trim();
}

// Defensive normalisation to the v1.2 contract so the native UI can render without
// per-field guards. `schema:'v1.2'` lets the render distinguish new cards from
// stored v1 cards (which lack metric_blocks) and degrade gracefully. Caps are
// boundary-safe (clampText) and sized to fit a complete coaching sentence (fix 1.A).
// Canonical short labels — applied BEFORE the cap so a long label is abbreviated,
// never mid-word cut (v1.2.2 fix 2.C: "Rate of Perceived Exerti").
const LABEL_MAP = {
  'rate of perceived exertion': 'RPE', 'perceived exertion': 'RPE', 'rpe': 'RPE',
  'heart rate': 'Heart Rate', 'hr': 'HR', 'pace': 'Pace', 'cadence': 'Cadence',
  'elevation': 'Elevation', 'terrain': 'Terrain', 'power': 'Power',
};
function normLabel(s) {
  const raw = String(s ?? '').trim();
  const mapped = LABEL_MAP[raw.toLowerCase()];
  if (mapped) return mapped;
  if (raw.length <= 24) return raw;
  const sp = raw.slice(0, 24).lastIndexOf(' ');   // word boundary, never mid-word
  return (sp > 0 ? raw.slice(0, sp) : raw.slice(0, 24)).trim();
}

export function coerceAnalysisShape(obj) {
  const arr = (v) => (Array.isArray(v) ? v : []);
  const v = obj.verdict || {};
  return {
    schema: 'v1.2',
    sport: obj.sport || 'other',
    verdict: {
      call: clampText(v.call, 80),                 // v1.2.2: short qualitative call, metric-free
      plan_verdict: PLAN_VERDICTS.includes(v.plan_verdict) ? v.plan_verdict : 'no_plan',
      action: v.action != null ? clampText(v.action, 140) : null,
    },
    type_inference: obj.type_inference != null ? clampText(obj.type_inference, 120) : null,
    summary: clampText(obj.summary, 450),
    measured_against: obj.measured_against != null ? String(obj.measured_against) : null,
    metric_blocks: arr(obj.metric_blocks).map(b => {
      const key = String(b?.metric_key ?? 'other');
      // Cadence is steps-per-minute — never bpm (v1.2.2 fix 2.D).
      const fixUnit = (s) => (key === 'cadence' && s != null ? String(s).replace(/\bbpm\b/gi, 'spm') : s);
      return {
        metric_key: key,
        label: normLabel(b?.label),
        canonical_value: String(fixUnit(b?.canonical_value) ?? '').slice(0, 24),
        session_line: clampText(fixUnit(b?.session_line), 120),
        plan_line: b?.plan_line != null ? clampText(fixUnit(b.plan_line), 120) : null,
        annotation: clampText(fixUnit(b?.annotation), 220),   // MANDATORY — always a string
        data_available: b?.data_available !== false,
      };
    }),
    flags: arr(obj.flags).map(f => ({
      type: String(f?.type ?? 'info'),
      severity: f?.severity === 'warn' ? 'warn' : 'info',
      message: clampText(f?.message, 120),                 // TERSE label-style, not prose
    })),
  };
}

// ── Source-freshness fingerprints (ticket 9808c786) ──────────────────
// A stored coach_analysis bakes in the ACTIVE-injury set and the zone definitions
// at generation time. The injury/zone-change DB triggers POST force:true broadly;
// these fingerprints let a force regen detect that the injury set + zones an
// activity actually depends on are UNCHANGED and skip the LLM (no needless regen
// or version churn), while a real change (e.g. an injury resolved) regenerates.

// Deterministic JSON (sorted keys) so equal zone objects always fingerprint equal.
export function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
}

export function injuryFingerprint(injuries) {
  if (!Array.isArray(injuries) || injuries.length === 0) return 'none';
  return injuries
    .map(i => `${i.body_location ?? ''}|${i.severity ?? ''}|${i.follow_up_overdue ? 1 : 0}`)
    .sort()
    .join(';');
}

export function zoneFingerprint(settings) {
  const z = settings?.hr_zones ?? settings?.training_zones ?? null;
  return z == null ? 'none' : stableStringify(z);
}

// True when a TRIGGER-driven force regen can be skipped because the injury set AND
// zones this activity's stored analysis baked in are unchanged. A manual force
// (no/'manual' reason) always regenerates; a card with no stored fingerprint
// (legacy) always regenerates once.
export function shouldSkipRegen({ force, regenReason, prevAudit, injuryFp, zoneFp }) {
  if (force !== true) return false;
  if (regenReason !== 'injury_change' && regenReason !== 'zone_change') return false;
  const a = (prevAudit && typeof prevAudit === 'object') ? prevAudit : {};
  if (a.injury_fingerprint === undefined || a.zone_fingerprint === undefined) return false;
  // Schema bump (v1.2 card redesign): a card stored under an older prompt_version
  // must regenerate even if injury+zone are unchanged. PRESERVES #11's guard.
  if (a.prompt_version !== SCHEMA_VERSION) return false;
  return a.injury_fingerprint === injuryFp && a.zone_fingerprint === zoneFp;
}

// ── Handler ──────────────────────────────────────────────────────────
export default async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method not allowed' });

  // AUTH — public URL doing privileged writes. No secret, no run.
  const secret = req.headers['x-analyze-secret'] || req.headers['X-Analyze-Secret'];
  if (!process.env.ANALYZE_ACTIVITY_SECRET || secret !== process.env.ANALYZE_ACTIVITY_SECRET) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }

  const { activity_id, force, reason: regenReason } = req.body || {};
  if (activity_id == null) return res.status(400).json({ ok: false, error: 'activity_id required' });

  // 1. Activity row (summary + audit fields).
  const cols = 'id,strava_id,user_id,date,type,workout_type,source,distance_km,duration_min,avg_hr,max_hr,avg_cadence,elevation_m,pace_per_km,splits_metric,splits_source,zone_data,enrichment_status,rpe,feel,feel_legs,injury_flag,coach_analysis,coach_analysis_version,prompt_data_completeness';
  const rows = await restGet(`activities?id=eq.${activity_id}&select=${cols}`);
  const activity = rows[0];
  if (!activity) return res.status(404).json({ ok: false, error: 'activity not found' });

  // 2. Streams + splits → completeness inputs.
  const streamRows = await restGet(
    `activity_streams?activity_id=eq.${activity.id}&is_deleted=eq.false&select=zone_seconds,cadence_stats,grade_correlation,samples`
  );
  const streams = streamRows[0] || null;
  const samples = Array.isArray(streams?.samples) ? streams.samples : [];
  const splits = Array.isArray(activity.splits_metric) ? activity.splits_metric : null;
  const hasSamples = samples.length > 0;
  const hasSplits = Array.isArray(splits) && splits.length > 0;

  // 3. Dual-source guard — duplicate-shaped sibling already analysed?
  let sibling = null;
  if (activity.coach_analysis == null || force === true) {
    const day = viennaDate(activity.date);
    const start = `${day}T00:00:00`;
    const end = `${day}T23:59:59`;
    const candidates = await restGet(
      `activities?user_id=eq.${activity.user_id}&id=neq.${activity.id}&coach_analysis=not.is.null&date=gte.${start}.000Z&date=lte.${end}.999Z&select=id,date,distance_km,duration_min,coach_analysis`
    );
    sibling = findDuplicateSibling(activity, candidates);
  }

  const { skip, reason } = decideSkip({ activity, hasSamples, hasSplits, sibling, force });
  if (skip) return res.status(200).json({ ok: true, activity_id: activity.id, skipped: reason });

  // 4. Build context INLINE (athlete_state_snapshot does NOT exist — assemble).
  const sport = sportOf(activity);
  const dayVienna = viennaDate(activity.date);

  const [plannedRows, settingsRows, sportsRows, trendRows, injuryRows] = await Promise.all([
    restGet(`scheduled_sessions?user_id=eq.${activity.user_id}&planned_date=eq.${dayVienna}&select=name,session_type,zone,intensity,duration_min_low,duration_min_high,notes,status&limit=1`),
    restGet(`athlete_settings?user_id=eq.${activity.user_id}&select=hr_zones,training_zones,goal_type,current_level,races,health_flags&limit=1`),
    restGet(`athlete_sports?user_id=eq.${activity.user_id}&select=sport_raw,sport_category,priority`),
    restGet(`activities?user_id=eq.${activity.user_id}&id=neq.${activity.id}&type=eq.${encodeURIComponent(activity.type ?? '')}&order=date.desc&limit=5&select=date,distance_km,duration_min,avg_hr,pace_per_km`),
    // ACTIVE injuries — status-based rule: surface status='active' REGARDLESS of
    // follow_up_due_date. An active injury past its follow-up is the MOST important
    // to surface, not silently drop. (enrich-activity currently filters by
    // follow_up_due_date >= today — a divergence flagged for a fast-follow.)
    restGet(`injury_reports?user_id=eq.${activity.user_id}&status=eq.active&select=body_location,severity,status,follow_up_due_date&order=follow_up_due_date.asc.nullslast`),
  ]);
  const plannedSession = plannedRows[0] || null;
  const settings = settingsRows[0] || null;
  const sports = sportsRows || [];
  const trend = trendRows || [];
  // Flag overdue follow-ups (relative to today, Europe/Vienna) so the prompt can
  // surface "follow-up overdue since <date>" as context.
  const todayVienna = viennaDate(new Date());
  const injuries = (injuryRows || []).map(inj => ({
    ...inj,
    follow_up_overdue: inj.follow_up_due_date != null && String(inj.follow_up_due_date) < todayVienna,
  }));

  // Source fingerprints for the injury/zone-change regen triggers (9808c786).
  const injuryFp = injuryFingerprint(injuries);
  const zoneFp = zoneFingerprint(settings);
  // A trigger fired force:true, but if this activity's baked-in injury set AND
  // zones are unchanged, skip the LLM entirely (no regen / no version churn).
  if (shouldSkipRegen({ force, regenReason, prevAudit: activity.prompt_data_completeness, injuryFp, zoneFp })) {
    return res.status(200).json({ ok: true, activity_id: activity.id, skipped: 'source_unchanged', reason: regenReason });
  }

  const completeness = buildCompleteness({ activity, sport, streams, splits, plannedSession, trend, injuries });
  const { system, user } = buildAnalysisPrompt({
    activity, sport, streams, splits, plannedSession, settings, sports, trend, injuries, completeness,
  });

  // 5. Generate — up to 2 attempts. max_tokens=2500 comfortably fits the full
  //    bounded schema (worst case ~1k output tokens) with ~2x headroom, fixing
  //    the truncation that produced parse_failed on data-rich activities. Each
  //    attempt prefills the assistant turn with "{" so the model starts the
  //    JSON object immediately (no prose/fence preamble). One retry recovers
  //    the occasional transient truncation/format slip.
  let parsed = null;
  let httpStatus = 0;
  let lastError = 'no attempt';
  for (let attempt = 1; attempt <= 2; attempt++) {
    const resp = await callAnthropic({
      model: DEFAULT_MODEL, max_tokens: 2500, system,
      messages: [
        { role: 'user', content: user },
        { role: 'assistant', content: '{' },
      ],
    });
    httpStatus = resp.httpStatus;
    const cont = (resp.data?.content || []).filter(b => b.type === 'text').map(b => b.text || '').join('\n');
    const attemptParsed = parseAnalysisJSON('{' + cont);
    if (attemptParsed.ok) { parsed = attemptParsed; break; }
    lastError = attemptParsed.error;
  }

  if (!parsed) {
    // Both attempts failed. Store the audit so the failure is diagnosable, but
    // DO NOT write coach_analysis — leaving it null keeps the activity eligible
    // for a retry (trigger re-fire or force). Return 5xx as the contract requires.
    await restPatch('activities', `id=eq.${activity.id}`, {
      prompt_data_completeness: { ...completeness, generation_status: 'parse_failed', parse_error: lastError },
    });
    return res.status(502).json({ ok: false, activity_id: activity.id, error: `analysis parse failed: ${lastError}`, anthropic_status: httpStatus });
  }

  // 6. Write back.
  const version = force === true ? (Number(activity.coach_analysis_version) || 1) + 1 : 1;
  const patchStatus = await restPatch('activities', `id=eq.${activity.id}`, {
    coach_analysis: parsed.value,
    coach_analysis_generated_at: new Date().toISOString(),
    coach_analysis_model: DEFAULT_MODEL,
    coach_analysis_version: version,
    prompt_data_completeness: { ...completeness, generation_status: 'ok', injury_fingerprint: injuryFp, zone_fingerprint: zoneFp },
  });
  if (patchStatus >= 300) {
    return res.status(500).json({ ok: false, activity_id: activity.id, error: `write-back failed: ${patchStatus}` });
  }

  return res.status(200).json({ ok: true, activity_id: activity.id, version, sport });
}
