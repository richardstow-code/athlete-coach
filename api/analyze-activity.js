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

  return {
    prompt_version: 'analyze-activity@v1.1',
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
        const pace = s.avg_speed_mps > 0 ? (1000 / s.avg_speed_mps / 60).toFixed(2) : '?';
        return `#${s.idx}: ${km}km @ ${pace}min/km${s.avg_hr != null ? `, HR ${s.avg_hr}` : ''}`;
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
1. NEVER FABRICATE. ${naLine} In particular, effort_read.primary_zone MUST be "n/a" whenever HR-zone data is NOT AVAILABLE — do NOT infer a training zone from pace, RPE, or the planned session. You may reference the PLANNED zone in a note, but never assert a measured zone the data does not contain.
2. RAW RPE. Athlete RPE is raw on a 1-10 scale (NOT a feel score). Interpret it against the planned session's intended intensity: a low RPE on a planned easy/Z2 session is GOOD execution; a high RPE on an easy session is a fatigue/heat/drift signal; a low RPE on a planned hard session is under-execution. Never invert RPE into a valenced "feel".
3. ${hrGuard || 'Use only HR-zone values actually present in the data.'}
4. PLAN-FIRST. If a planned session is supplied, execution_vs_plan MUST compare actual zone/duration/intensity to it. If none, verdict is "no_plan".
5. TAG MISMATCH. If the activity's workout_type / planned session implies intensity (tempo / threshold / interval / hard) but the effort was actually predominantly easy (Z1-Z2 / low RPE), SURFACE this as a flag (type "tag_mismatch"). This is high-value — do not smooth it over.
6. INJURY-AWARE. If ACTIVE INJURIES are listed, you MUST acknowledge in one short clause how THIS session interacts with the injured area (load/aggravation risk). An active injury whose follow_up_overdue is true is the MOST important to surface — never omit it; note "follow-up overdue since <follow_up_due>" and surface it as a flag (severity "warn"). Do not invent injuries that are not listed.
7. Use only values present below (subjective rpe/feel/feel_legs are RAW — never compute a feel score). Reference specific numbers; no boilerplate, no motivational sign-offs.

OUTPUT: Output ONLY a single complete, valid JSON object matching the schema below — no markdown, no code fence, no prose before or after. Do not wrap it in \`\`\`. Keep it COMPACT so the whole object fits: stay within the length caps. Exactly this shape:
{
  "headline": "string, <= 90 chars",
  "sport": "${sport}",
  "execution_vs_plan": { "planned_session": "string|null", "verdict": "as_planned|easier|harder|off_plan|no_plan", "note": "string, <= 160 chars" },
  "effort_read": { "primary_zone": "z1|z2|z3|z4|z5|n/a", "distribution_note": "string, <= 160 chars" },
  "key_signals": [ { "label": "string, <= 24 chars", "value": "string, <= 24 chars", "read": "string, <= 120 chars" } ],
  "flags": [ { "type": "string", "severity": "info|warn", "message": "string, <= 140 chars" } ],
  "coach_note": "1-3 short sentences in your coaching voice, <= 320 chars"
}
key_signals: 2-4 items grounded in real numbers. flags: empty array [] if nothing notable. Respect every character cap — a complete object matters more than verbosity.`;

  const user = `ACTIVITY (summary):
${JSON.stringify({
    name: activity.name, type: activity.type, workout_type: activity.workout_type,
    date_vienna: viennaDate(activity.date), distance_km: activity.distance_km,
    duration_min: activity.duration_min, avg_hr: activity.avg_hr, max_hr: activity.max_hr,
    avg_cadence: activity.avg_cadence, elevation_m: activity.elevation_m, pace_per_km: activity.pace_per_km,
    rpe: activity.rpe ?? null, feel: activity.feel ?? null, feel_legs: activity.feel_legs ?? null, injury_flag: activity.injury_flag ?? null,
  })}

HR ZONE DISTRIBUTION: ${zoneDistribution}
CADENCE STATS (avg + 5-seg trend): ${JSON.stringify(streams?.cadence_stats ?? null)}
GRADE CORRELATION: ${JSON.stringify(streams?.grade_correlation ?? null)}
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
  if (typeof obj.headline !== 'string' || typeof obj.coach_note !== 'string') {
    return { ok: false, error: 'missing required headline/coach_note' };
  }
  return { ok: true, value: coerceAnalysisShape(obj) };
}

// Defensive normalisation to the STEP 2 contract so the native UI can render
// without per-field guards.
export function coerceAnalysisShape(obj) {
  const arr = (v) => (Array.isArray(v) ? v : []);
  const evp = obj.execution_vs_plan || {};
  const er = obj.effort_read || {};
  return {
    headline: String(obj.headline).slice(0, 90),
    sport: obj.sport || 'other',
    execution_vs_plan: {
      planned_session: evp.planned_session ?? null,
      verdict: evp.verdict || 'no_plan',
      note: evp.note || '',
    },
    effort_read: {
      primary_zone: er.primary_zone || 'n/a',
      distribution_note: er.distribution_note || '',
    },
    key_signals: arr(obj.key_signals).map(s => ({
      label: String(s?.label ?? ''), value: String(s?.value ?? ''), read: String(s?.read ?? ''),
    })),
    flags: arr(obj.flags).map(f => ({
      type: String(f?.type ?? 'info'),
      severity: f?.severity === 'warn' ? 'warn' : 'info',
      message: String(f?.message ?? ''),
    })),
    coach_note: String(obj.coach_note),
  };
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

  const { activity_id, force } = req.body || {};
  if (activity_id == null) return res.status(400).json({ ok: false, error: 'activity_id required' });

  // 1. Activity row (summary + audit fields).
  const cols = 'id,strava_id,user_id,date,type,workout_type,source,distance_km,duration_min,avg_hr,max_hr,avg_cadence,elevation_m,pace_per_km,splits_metric,splits_source,zone_data,enrichment_status,rpe,feel,feel_legs,injury_flag,coach_analysis,coach_analysis_version';
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
    prompt_data_completeness: { ...completeness, generation_status: 'ok' },
  });
  if (patchStatus >= 300) {
    return res.status(500).json({ ok: false, activity_id: activity.id, error: `write-back failed: ${patchStatus}` });
  }

  return res.status(200).json({ ok: true, activity_id: activity.id, version, sport });
}
