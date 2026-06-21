// _mcpTools.js — the seven read-only Coach Claude MCP tools (Phase 1).
//
// Each tool is a pure async fn (client, args, opts) -> plain object. They NEVER
// throw to the caller: any failure is returned as { error }. Every tool is
// scoped to a single athlete (opts.userId, default ATHLETE_USER_ID). Missing
// data is returned as an explicit NOT_AVAILABLE marker string, never an absent
// key and never fabricated (Architect data-sparseness rule).
//
// WRAP, DON'T REIMPLEMENT (Architect tiering):
//   Tier 1 (RPC):  get_athlete_profile, get_training_zones (HR) wrap
//                  get_athlete_coaching_context — zones come out of the
//                  canonical context (resolved from training_zones), NEVER the
//                  NULL hr_zones column, NEVER recomputed here.
//   Tier 2 (read): recent_activities, activity_detail, scheduled_sessions,
//                  recovery, coaching_memory, pace zones — plain column reads.
//   Tier 3 marker: activity classification re-implements the native thresholds
//                  (native TS not importable cross-repo) — flagged in docs;
//                  candidate for a future classify RPC so it cannot drift.

export const ATHLETE_USER_ID = '40cfe68e-faea-491c-b410-0093572f02d6';
export const NOT_AVAILABLE = 'NOT AVAILABLE';

// ── Vienna date helpers (Ground Rule 3: en-CA Europe/Vienna, never UTC) ──
export function viennaDateOf(value) {
  return new Date(value).toLocaleDateString('en-CA', { timeZone: 'Europe/Vienna' });
}
export function viennaToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Vienna' });
}
function addDaysISO(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ── Activity classification (mirrors native app/activity/[id].tsx:647-756) ──
// Returns 'trail' | 'interval' | 'easy'. 'trail' suppresses interval framing.
export function classifyActivity(act) {
  const type = String(act?.type || '').toLowerCase();
  if (type.includes('hike') || type.includes('walk') || type.includes('trail')) return 'trail';
  const wt = String(act?.workout_type || '').toLowerCase();
  if (/interval|threshold|tempo|workout|rep|fartlek|vo2/.test(wt)) return 'interval';
  return 'easy';
}

function err(message, extra) {
  return { error: message, ...(extra || {}) };
}

// ─────────────────────────────────────────────────────────────────────────
// 1. get_athlete_profile — TIER 1 (RPC) + tone slider raw read
// ─────────────────────────────────────────────────────────────────────────
export async function getAthleteProfile(client, _args = {}, opts = {}) {
  const userId = opts.userId || ATHLETE_USER_ID;
  try {
    const rpc = await client.callRPC('get_athlete_coaching_context', {
      p_user_id: userId,
      p_surface_type: 'chat',
      p_activity_id: null,
      p_route_id: null,
      p_session_id: null,
    });
    if (!rpc.ok || !rpc.data) return err(`coaching-context RPC failed (status ${rpc.status})`);
    const core = rpc.data.core || {};
    const a = core.athlete || {};

    // tone is a numeric slider not carried by the RPC payload — plain read.
    let tone = NOT_AVAILABLE;
    try {
      const rows = await client.restGet(
        `athlete_settings?user_id=eq.${userId}&select=tone&limit=1`
      );
      tone = rows[0]?.tone ?? NOT_AVAILABLE;
    } catch {
      tone = NOT_AVAILABLE;
    }

    return {
      name: a.name ?? NOT_AVAILABLE,
      age: a.age ?? NOT_AVAILABLE,
      current_level: a.current_level ?? NOT_AVAILABLE,
      user_mode: a.user_mode ?? NOT_AVAILABLE,
      goal_type: a.goal_type ?? NOT_AVAILABLE,
      coaching_character: a.coaching_character ?? NOT_AVAILABLE,
      tone,
      primary_sport: core.primary_sport ?? NOT_AVAILABLE,
      supporting_sports: core.supporting_sports ?? [],
      next_race: core.next_race ?? NOT_AVAILABLE,
      source: 'get_athlete_coaching_context (athlete-coaching-context@v2) + athlete_settings.tone',
    };
  } catch (e) {
    return err(`get_athlete_profile failed: ${e.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 2. get_recent_activities — TIER 2, Vienna-bucketed date range
// ─────────────────────────────────────────────────────────────────────────
export async function getRecentActivities(client, args = {}, opts = {}) {
  const userId = opts.userId || ATHLETE_USER_ID;
  const to = args.to || viennaToday();
  const from = args.from || addDaysISO(to, -14);
  const limit = Math.min(Math.max(Number(args.limit) || 50, 1), 200);
  try {
    // Widen the UTC window by a day each side so timestamps that fall on the
    // adjacent UTC day but the same Vienna day are not dropped, then bucket by
    // Vienna calendar date and filter precisely.
    const loUtc = `${addDaysISO(from, -1)}T00:00:00Z`;
    const hiUtc = `${addDaysISO(to, 1)}T00:00:00Z`;
    const rows = await client.restGet(
      `activities?user_id=eq.${userId}&is_deleted=eq.false` +
        `&date=gte.${loUtc}&date=lte.${hiUtc}` +
        `&select=id,name,date,type,distance_km,duration_min,avg_hr,max_hr,elevation_m,pace_per_km,rpe` +
        `&order=date.desc`
    );
    const activities = rows
      .map((r) => ({ ...r, vienna_date: viennaDateOf(r.date) }))
      .filter((r) => r.vienna_date >= from && r.vienna_date <= to)
      .slice(0, limit);
    return { range: { from, to }, count: activities.length, activities };
  } catch (e) {
    return err(`get_recent_activities failed: ${e.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 3. get_activity_detail — TIER 2 + intervals attribution + sparseness markers
// ─────────────────────────────────────────────────────────────────────────
export async function getActivityDetail(client, args = {}, opts = {}) {
  const userId = opts.userId || ATHLETE_USER_ID;
  const activityId = args.activity_id;
  if (activityId === undefined || activityId === null) return err('activity_id is required');
  try {
    const rows = await client.restGet(
      `activities?id=eq.${activityId}&user_id=eq.${userId}&is_deleted=eq.false` +
        `&select=id,name,date,type,workout_type,distance_km,duration_min,avg_hr,max_hr,` +
        `elevation_m,pace_per_km,rpe,feel_legs,injury_flag,splits_metric,splits_source`
    );
    const act = rows[0];
    if (!act) return err(`activity ${activityId} not found`);

    const viennaDate = viennaDateOf(act.date);
    const classification = classifyActivity(act);

    const splits = Array.isArray(act.splits_metric) && act.splits_metric.length
      ? act.splits_metric
      : NOT_AVAILABLE;

    // Intervals are keyed (user_id, date) with no activity_id — ambiguous on
    // multi-activity days (known Phase-0 limitation, not fixed in Phase 1).
    let intervals = NOT_AVAILABLE;
    let intervals_attribution = 'attributed (single activity this date)';
    if (classification === 'trail') {
      intervals = NOT_AVAILABLE;
      intervals_attribution = 'n/a (trail/hike — no interval framing)';
    } else {
      const sameDay = await client.restGet(
        `activities?user_id=eq.${userId}&is_deleted=eq.false` +
          `&date=gte.${addDaysISO(viennaDate, -1)}T00:00:00Z` +
          `&date=lte.${addDaysISO(viennaDate, 1)}T00:00:00Z&select=id,date`
      );
      const sameDayCount = sameDay.filter((r) => viennaDateOf(r.date) === viennaDate).length;
      if (sameDayCount > 1) {
        intervals = NOT_AVAILABLE;
        intervals_attribution = 'ambiguous (multiple activities this date)';
      } else {
        const ivRows = await client.restGet(
          `intervals_data?user_id=eq.${userId}&date=eq.${viennaDate}` +
            `&select=icu_intensity,training_load,hr_zone_times,interval_summary`
        );
        const iv = ivRows[0];
        if (iv && iv.icu_intensity != null) {
          intervals = {
            icu_intensity: iv.icu_intensity,
            training_load: iv.training_load ?? NOT_AVAILABLE,
            hr_zone_times: iv.hr_zone_times ?? NOT_AVAILABLE,
            interval_summary: iv.interval_summary ?? NOT_AVAILABLE,
          };
        } else {
          intervals = NOT_AVAILABLE;
        }
      }
    }

    return {
      id: act.id,
      name: act.name,
      date: act.date,
      vienna_date: viennaDate,
      type: act.type,
      workout_type: act.workout_type ?? NOT_AVAILABLE,
      classification,
      distance_km: act.distance_km ?? NOT_AVAILABLE,
      duration_min: act.duration_min ?? NOT_AVAILABLE,
      avg_hr: act.avg_hr ?? NOT_AVAILABLE,
      max_hr: act.max_hr ?? NOT_AVAILABLE,
      elevation_m: act.elevation_m ?? NOT_AVAILABLE,
      pace_per_km: act.pace_per_km ?? NOT_AVAILABLE,
      rpe: act.rpe ?? NOT_AVAILABLE,
      feel_legs: act.feel_legs ?? NOT_AVAILABLE,
      injury_flag: act.injury_flag ?? NOT_AVAILABLE,
      splits,
      splits_source: act.splits_source ?? NOT_AVAILABLE,
      intervals,
      intervals_attribution,
    };
  } catch (e) {
    return err(`get_activity_detail failed: ${e.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 4. get_scheduled_sessions — TIER 2, status-aware (no 'cancelled' enum)
// ─────────────────────────────────────────────────────────────────────────
const ALL_STATUSES = [
  'planned', 'completed', 'missed', 'completed_different', 'rest_observed', 'superseded',
];
export async function getScheduledSessions(client, args = {}, opts = {}) {
  const userId = opts.userId || ATHLETE_USER_ID;
  const from = args.from || viennaToday();
  const to = args.to || addDaysISO(from, 7);
  try {
    let statusClause = '&status=neq.superseded'; // default: exclude superseded only
    if (Array.isArray(args.statuses) && args.statuses.length) {
      const wanted = args.statuses.includes('all')
        ? ALL_STATUSES
        : args.statuses.filter((s) => ALL_STATUSES.includes(s));
      statusClause = wanted.length ? `&status=in.(${wanted.join(',')})` : '';
    }
    const rows = await client.restGet(
      `scheduled_sessions?user_id=eq.${userId}` +
        `&planned_date=gte.${from}&planned_date=lte.${to}${statusClause}` +
        `&select=id,name,planned_date,session_type,zone,intensity,` +
        `duration_min_low,duration_min_high,status,notes,is_benchmark` +
        `&order=planned_date.asc`
    );
    return { range: { from, to }, count: rows.length, sessions: rows };
  } catch (e) {
    return err(`get_scheduled_sessions failed: ${e.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 5. get_training_zones — TIER 1 (HR from RPC, never hr_zones col) + pace read
// ─────────────────────────────────────────────────────────────────────────
export async function getTrainingZones(client, _args = {}, opts = {}) {
  const userId = opts.userId || ATHLETE_USER_ID;
  try {
    const rpc = await client.callRPC('get_athlete_coaching_context', {
      p_user_id: userId,
      p_surface_type: 'chat',
      p_activity_id: null,
      p_route_id: null,
      p_session_id: null,
    });
    const zones = rpc.ok ? rpc.data?.core?.zones : null;
    const heart_rate = zones
      ? { zones, source: 'athlete_settings.training_zones (resolved via get_athlete_coaching_context); hr_zones column is never read' }
      : NOT_AVAILABLE;

    let pace = NOT_AVAILABLE;
    try {
      const rows = await client.restGet(
        `athlete_settings?user_id=eq.${userId}&select=pace_zones&limit=1`
      );
      pace = rows[0]?.pace_zones ?? NOT_AVAILABLE;
    } catch {
      pace = NOT_AVAILABLE;
    }

    return { heart_rate, pace };
  } catch (e) {
    return err(`get_training_zones failed: ${e.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 6. get_recovery — TIER 2, athlete_state_snapshot view + intervals load
// ─────────────────────────────────────────────────────────────────────────
export async function getRecovery(client, _args = {}, opts = {}) {
  const userId = opts.userId || ATHLETE_USER_ID;
  try {
    let snap = null;
    try {
      const rows = await client.restGet(
        `athlete_state_snapshot?user_id=eq.${userId}` +
          `&select=resting_hr,hrv_ms,sleep_hours,sleep_quality,steps,` +
          `resting_hr_date,hrv_date,sleep_date,has_resting_hr,has_hrv,has_sleep,` +
          `snapshot_date,snapshot_sources&limit=1`
      );
      snap = rows[0] || null;
    } catch {
      snap = null;
    }

    let load = NOT_AVAILABLE;
    try {
      const rows = await client.restGet(
        `intervals_data?user_id=eq.${userId}&ctl=not.is.null` +
          `&select=date,ctl,atl,tsb&order=date.desc&limit=1`
      );
      const r = rows[0];
      if (r) load = { ctl: r.ctl, atl: r.atl, tsb: r.tsb, date: r.date };
    } catch {
      load = NOT_AVAILABLE;
    }

    const recovery = {
      resting_hr: snap?.has_resting_hr
        ? { value: snap.resting_hr, date: snap.resting_hr_date, source: snap.snapshot_sources?.resting_hr ?? null }
        : NOT_AVAILABLE,
      hrv: snap?.has_hrv
        ? { value_ms: snap.hrv_ms, date: snap.hrv_date, source: snap.snapshot_sources?.hrv_ms ?? null }
        : NOT_AVAILABLE,
      sleep: snap?.has_sleep
        ? { hours: snap.sleep_hours, quality: snap.sleep_quality ?? NOT_AVAILABLE, date: snap.sleep_date }
        : NOT_AVAILABLE,
    };

    return {
      recovery,
      training_load: load,
      snapshot_date: snap?.snapshot_date ?? NOT_AVAILABLE,
    };
  } catch (e) {
    return err(`get_recovery failed: ${e.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 7. get_coaching_memory — TIER 2, filter by type/category/date
// ─────────────────────────────────────────────────────────────────────────
export async function getCoachingMemory(client, args = {}, opts = {}) {
  const userId = opts.userId || ATHLETE_USER_ID;
  const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 50);
  try {
    let q = `coaching_memory?user_id=eq.${userId}&select=date,type,category,source,content` +
      `&order=created_at.desc&limit=${limit}`;
    if (args.type) q += `&type=eq.${encodeURIComponent(args.type)}`;
    if (args.category) q += `&category=eq.${encodeURIComponent(args.category)}`;
    if (args.from) q += `&date=gte.${args.from}`;
    if (args.to) q += `&date=lte.${args.to}`;
    const rows = await client.restGet(q);
    return { count: rows.length, memory: rows };
  } catch (e) {
    return err(`get_coaching_memory failed: ${e.message}`);
  }
}

// ── Registry: name, description, and the fn. (Zod input shapes live in mcp.js
//    so this module stays dependency-free and unit-testable.) ──
export const TOOLS = [
  {
    name: 'get_athlete_profile',
    description:
      'Athlete identity, sports, goal/target race + countdown, coaching tone. Single athlete.',
    fn: getAthleteProfile,
  },
  {
    name: 'get_recent_activities',
    description:
      'Recent activities over a Europe/Vienna date range (default last 14 days). Type, distance, duration, HR, elevation, pace, RPE.',
    fn: getRecentActivities,
  },
  {
    name: 'get_activity_detail',
    description:
      'One activity by id with splits, classification (trail/interval/easy), and intervals data when unambiguously attributable. Missing data is marked NOT AVAILABLE.',
    fn: getActivityDetail,
  },
  {
    name: 'get_scheduled_sessions',
    description:
      'Planned sessions over a date range with status. Excludes superseded by default; optional statuses filter. There is no cancelled status.',
    fn: getScheduledSessions,
  },
  {
    name: 'get_training_zones',
    description:
      'Canonical HR zones (from training_zones via the coaching-context RPC; the hr_zones column is never read) plus pace zones.',
    fn: getTrainingZones,
  },
  {
    name: 'get_recovery',
    description:
      'Resting HR, HRV, sleep (athlete_state_snapshot) plus CTL/ATL/TSB load. Each missing metric is marked NOT AVAILABLE.',
    fn: getRecovery,
  },
  {
    name: 'get_coaching_memory',
    description:
      'Recent coaching memory notes, optionally filtered by type/category/date range.',
    fn: getCoachingMemory,
  },
];
