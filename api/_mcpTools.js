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
// Whole days between a metric date and a reference day (plain date math — NOT a
// freshness threshold; the canonical 24/24/36h thresholds live in the RPC).
export function daysSince(isoDate, todayISO) {
  if (!isoDate) return null;
  const a = new Date(`${String(isoDate).slice(0, 10)}T00:00:00Z`);
  const b = new Date(`${todayISO}T00:00:00Z`);
  return Math.round((b - a) / 86400000);
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
        `&select=id,name,date,type,distance_km,duration_min,avg_hr,max_hr,elevation_m,pace_per_km,rpe,compliance_score` +
        `&order=date.desc`
    );
    const activities = rows
      .map((r) => ({ ...r, vienna_date: viennaDateOf(r.date), compliance_score: r.compliance_score ?? NOT_AVAILABLE }))
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
        `elevation_m,pace_per_km,rpe,feel_legs,injury_flag,splits_metric,splits_source,` +
        `compliance_score,compliance_grade,compliance_summary`
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
      compliance_score: act.compliance_score ?? NOT_AVAILABLE,
      compliance_grade: act.compliance_grade ?? NOT_AVAILABLE,
      compliance_summary: act.compliance_summary ?? NOT_AVAILABLE,
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

    // age_days = whole days since the metric was measured (plain date math; the
    // canonical freshness threshold is NOT re-derived here — Architect ruling #4).
    const today = viennaToday();
    const recovery = {
      resting_hr: snap?.has_resting_hr
        ? { value: snap.resting_hr, date: snap.resting_hr_date, age_days: daysSince(snap.resting_hr_date, today), source: snap.snapshot_sources?.resting_hr ?? null }
        : NOT_AVAILABLE,
      hrv: snap?.has_hrv
        ? { value_ms: snap.hrv_ms, date: snap.hrv_date, age_days: daysSince(snap.hrv_date, today), source: snap.snapshot_sources?.hrv_ms ?? null }
        : NOT_AVAILABLE,
      sleep: snap?.has_sleep
        ? { hours: snap.sleep_hours, quality: snap.sleep_quality ?? NOT_AVAILABLE, date: snap.sleep_date, age_days: daysSince(snap.sleep_date, today) }
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

// ═══════════════════════ PHASE 2 — nice-to-have reads ═══════════════════════

// 8. get_nutrition — TIER 2, nutrition_logs over a range + alcohol tally
export async function getNutrition(client, args = {}, opts = {}) {
  const userId = opts.userId || ATHLETE_USER_ID;
  const to = args.to || viennaToday();
  const from = args.from || addDaysISO(to, -7);
  try {
    const rows = await client.restGet(
      `nutrition_logs?user_id=eq.${userId}&date=gte.${from}&date=lte.${to}` +
        `&select=id,date,meal_name,meal_timing,calories,protein_g,carbs_g,fat_g,fibre_g,` +
        `sodium_mg,upf_score,rating,notes,alcohol_units,logged_at&order=date.asc,logged_at.asc`
    );
    const alcohol_units_total = rows.reduce((s, r) => s + (Number(r.alcohol_units) || 0), 0);
    return {
      range: { from, to },
      count: rows.length,
      alcohol_units_total: Math.round(alcohol_units_total * 10) / 10,
      entries: rows,
    };
  } catch (e) {
    return err(`get_nutrition failed: ${e.message}`);
  }
}

// 9. get_weekly_review — TIER 2, latest coaching_memory category='weekly_review'
export async function getWeeklyReview(client, _args = {}, opts = {}) {
  const userId = opts.userId || ATHLETE_USER_ID;
  try {
    const rows = await client.restGet(
      `coaching_memory?user_id=eq.${userId}&category=eq.weekly_review` +
        `&select=date,content,created_at&order=created_at.desc&limit=1`
    );
    const r = rows[0];
    if (!r) return { weekly_review: NOT_AVAILABLE, date: NOT_AVAILABLE };
    return { weekly_review: r.content ?? NOT_AVAILABLE, date: r.date ?? NOT_AVAILABLE, generated_at: r.created_at };
  } catch (e) {
    return err(`get_weekly_review failed: ${e.message}`);
  }
}

// 10. get_routes — TIER 2 list athlete_routes; TIER 1 per-route via RPC
export async function getRoutes(client, args = {}, opts = {}) {
  const userId = opts.userId || ATHLETE_USER_ID;
  try {
    if (args.route_id) {
      const rpc = await client.callRPC('get_route_coach_context', {
        p_user_id: userId,
        p_route_id: args.route_id,
        p_session_type: args.session_type || null,
      });
      if (!rpc.ok || !rpc.data) return err(`get_route_coach_context RPC failed (status ${rpc.status})`);
      return { route_coach_context: rpc.data };
    }
    // list — only named locations (privacy): no raw lat/lng
    const rows = await client.restGet(
      `athlete_routes?user_id=eq.${userId}` +
        `&select=id,name,reverse_geocode_name,sport_type,distance_km,elevation_m,` +
        `surface_type,terrain_profile,is_loop,activity_count,last_run_date` +
        `&order=activity_count.desc&limit=${Math.min(Math.max(Number(args.limit) || 10, 1), 50)}`
    );
    return { count: rows.length, routes: rows };
  } catch (e) {
    return err(`get_routes failed: ${e.message}`);
  }
}

// ═══════════════════════ PHASE 2 — writes (propose → commit) ════════════════
// Every write is propose-by-default: with commit !== true it returns the
// proposed diff and mutates nothing; with commit === true it performs the write
// and returns the ACTUAL mutated row. No silent-fill (only provided fields).

function proposal(table, op, payload, extra) {
  return { committed: false, commit_required: true, proposed: { table, op, payload }, ...(extra || {}) };
}

// 11. log_session_feedback — PATCH activities with the athlete's OWN subjective
// feedback. VERBATIM-ONLY guardrail (AC-153): this tool records what the ATHLETE
// actually said/scored. It NEVER derives rpe / feel_legs / injury_flag / notes
// from activity metrics (pace, HR, splits, distance, duration) for ANY sport,
// and it NEVER writes a third-person summary of the activity into
// subjective_notes. Two structural protections back the schema/description
// steering that lives in mcp.js and the TOOLS description:
//   (A) Partial update — only fields the caller explicitly supplied are written.
//       An omitted field is left UNTOUCHED in the DB (never nulled, never
//       defaulted). This alone preserves an existing note when, e.g., rpe is
//       sent on its own — PostgREST PATCH only writes the columns we send.
//   (B) Refuse-when-empty — with no athlete-provided subjective field the tool
//       writes nothing and returns a refusal, for both propose and commit. The
//       server never invents a value to fill the call.
// rpe is a RAW 1-10 integer (never a computed feel_score). `notes` maps to the
// real column `subjective_notes` (there is no `notes` column). subjective_captured_at
// is stamped only on a real subjective write. The activities table has no
// updated_at column, so it is never referenced.
export async function logSessionFeedback(client, args = {}, opts = {}) {
  const userId = opts.userId || ATHLETE_USER_ID;
  const activityId = args.activity_id;
  if (activityId === undefined || activityId === null) return err('activity_id is required');
  if (args.rpe !== undefined && args.rpe !== null) {
    if (!Number.isInteger(args.rpe) || args.rpe < 1 || args.rpe > 10) {
      return err('rpe must be a raw integer 1-10 (never a computed feel_score)');
    }
  }
  // (A) Partial update / no silent-fill: build the column set from ONLY the
  // subjective fields the caller explicitly supplied. `notes` → subjective_notes.
  const payload = {};
  if (args.rpe !== undefined) payload.rpe = args.rpe; // RAW passthrough
  if (args.feel_legs !== undefined) payload.feel_legs = args.feel_legs;
  if (args.injury_flag !== undefined) payload.injury_flag = args.injury_flag;
  if (args.notes !== undefined) payload.subjective_notes = args.notes;

  // (B) Refuse-when-empty: never fabricate subjective values to fill the call.
  if (Object.keys(payload).length === 0) {
    return {
      committed: false,
      refused: true,
      error:
        'No athlete-provided subjective values supplied — nothing to write. ' +
        'Ask the athlete for their RPE (1-10), how their legs felt, any injury ' +
        "flag, and their own note, then call again with those exact values. " +
        'Never infer, estimate, or summarise these from the activity metrics ' +
        '(pace, HR, splits, distance, duration).',
    };
  }

  // Real DB column names that this call will change (excludes the timestamp).
  const changed_columns = Object.keys(payload);
  payload.subjective_captured_at = new Date().toISOString();

  if (args.commit !== true) {
    return proposal('activities', `update (PATCH id=${activityId})`, payload, {
      changed_columns,
      note: 'only athlete-supplied fields are written; raw rpe passed through; no feel_score is computed or sent',
    });
  }
  try {
    const rows = await client.restPatch('activities', `id=eq.${activityId}&user_id=eq.${userId}`, payload);
    if (!rows || !rows.length) return err(`activity ${activityId} not found for this athlete`);
    return { committed: true, row: rows[0], changed_columns };
  } catch (e) {
    return err(`log_session_feedback failed: ${e.message}`);
  }
}

// 12. propose_schedule_change — INSERT schedule_changes status='pending' ONLY
export async function proposeScheduleChange(client, args = {}, opts = {}) {
  const userId = opts.userId || ATHLETE_USER_ID;
  if (!args.change_type) return err('change_type is required');
  if (!args.title) return err('title is required (schedule_changes.title is NOT NULL)');
  if (!args.reasoning) return err('reasoning is required (schedule_changes.reasoning is NOT NULL)');
  const payload = { user_id: userId, status: 'pending', proposed_by: 'mcp', change_type: args.change_type };
  for (const k of ['title', 'reasoning', 'original_session_id', 'new_date', 'new_name',
    'new_notes', 'new_intensity', 'new_duration_low', 'new_duration_high', 'proposed_session', 'context']) {
    if (args[k] !== undefined) payload[k] = args[k];
  }
  const guard = { guarantee: 'writes schedule_changes (status=pending) only; never mutates scheduled_sessions' };
  if (args.commit !== true) return proposal('schedule_changes', 'insert', payload, guard);
  try {
    const rows = await client.restPost('schedule_changes', payload);
    return { committed: true, row: rows[0], ...guard };
  } catch (e) {
    return err(`propose_schedule_change failed: ${e.message}`);
  }
}

// 13. write_coaching_memory — UPSERT onConflict (user_id,date,source)
export async function writeCoachingMemory(client, args = {}, opts = {}) {
  const userId = opts.userId || ATHLETE_USER_ID;
  if (!args.source) return err('source is required (part of the unique key user_id,date,source)');
  if (!args.content) return err('content is required');
  const payload = {
    user_id: userId,
    date: args.date || viennaToday(),
    source: args.source,
    content: args.content,
  };
  if (args.type !== undefined) payload.type = args.type;
  if (args.category !== undefined) payload.category = args.category;

  if (args.commit !== true) {
    return proposal('coaching_memory', 'upsert onConflict (user_id,date,source)', payload, {
      note: 'idempotent: re-running the same (user_id,date,source) merges, never double-inserts',
    });
  }
  try {
    const rows = await client.restPost('coaching_memory', payload, {
      onConflict: 'user_id,date,source',
      merge: true,
    });
    return { committed: true, row: rows[0] };
  } catch (e) {
    return err(`write_coaching_memory failed: ${e.message}`);
  }
}

// 14. update_athlete_profile — scoped to verified-real athlete_settings columns
const PROFILE_ALLOWED = ['weight_kg', 'goal_type', 'health_notes'];
export async function updateAthleteProfile(client, args = {}, opts = {}) {
  const userId = opts.userId || ATHLETE_USER_ID;
  const update = {};
  const rejected = [];
  for (const [k, v] of Object.entries(args)) {
    if (k === 'commit') continue;
    if (PROFILE_ALLOWED.includes(k)) update[k] = v;
    else rejected.push(k); // never silent-fill unknown/deferred columns
  }
  if (Object.keys(update).length === 0) {
    return err(`no updatable fields. Allowed: ${PROFILE_ALLOWED.join(', ')}. ` +
      'Race date / goal live in athlete_sports and are deferred.', { rejected_fields: rejected });
  }

  if (args.commit !== true) {
    return {
      committed: false,
      commit_required: true,
      proposed: { table: 'athlete_settings', op: 'upsert onConflict user_id', fields: update },
      rejected_fields: rejected,
      note: 'confirm each field, then resend with commit:true',
    };
  }
  try {
    const payload = { user_id: userId, ...update, updated_at: new Date().toISOString() };
    const rows = await client.restPost('athlete_settings', payload, { onConflict: 'user_id', merge: true });
    // best-effort audit row (mirrors the native PROFILE_UPDATE behaviour)
    try {
      await client.restPost(
        'coaching_memory',
        { user_id: userId, date: viennaToday(), type: 'profile_update', category: 'profile', source: 'mcp', content: JSON.stringify(update) },
        { onConflict: 'user_id,date,source', merge: true }
      );
    } catch { /* audit is non-fatal */ }
    return { committed: true, row: rows[0], rejected_fields: rejected };
  } catch (e) {
    return err(`update_athlete_profile failed: ${e.message}`);
  }
}

// ═══════════════════════ PHASE 3 — power tools (high blast radius) ══════════
// Writes are propose-by-default (commit:true to mutate) and return the ACTUAL
// mutated row(s) — never a fabricated confirmation. The three heavy mutators
// (apply_schedule_change, request_plan_regeneration, log_activity) ADDITIONALLY
// require confirm:true (explicit Richard-confirm) on top of commit:true.

// 15. get_athlete_state — TIER-1 thin wrap of the athlete_state_snapshot VIEW.
// Read-only, no derived maths. The view's has_X flags are LAST-KNOWN-EXISTENCE
// (was this metric ever recorded) — NOT the get_athlete_coaching_context
// data_completeness FRESHNESS flags. Labelled here so the two are not conflated
// (known pre-existing divergence; freshness is never recomputed in-server).
export async function getAthleteState(client, _args = {}, opts = {}) {
  const userId = opts.userId || ATHLETE_USER_ID;
  try {
    const rows = await client.restGet(
      `athlete_state_snapshot?user_id=eq.${userId}` +
        `&select=snapshot_date,resting_hr,hrv_ms,sleep_hours,sleep_quality,steps,active_calories,` +
        `resting_hr_date,hrv_date,sleep_date,has_resting_hr,has_hrv,has_sleep,has_steps,snapshot_sources,` +
        `injury_id,injury_body_location,injury_severity,injury_follow_up_due_date,injury_follow_up_overdue,` +
        `injury_days_since_reported,injury_follow_up_count&limit=1`
    );
    const s = rows[0];
    if (!s) return { state: NOT_AVAILABLE, note: 'no athlete_state_snapshot row for this athlete' };
    const today = viennaToday();
    const metric = (val, dateField) =>
      val === null || val === undefined
        ? NOT_AVAILABLE
        : { value: val, date: s[dateField] ?? NOT_AVAILABLE, age_days: daysSince(s[dateField], today) };
    return {
      snapshot_date: s.snapshot_date ?? NOT_AVAILABLE,
      // From the VIEW: last-known-EXISTENCE, NOT freshness/recency.
      existence_flags: {
        _meaning:
          'true = this metric has EVER been recorded (view has_X). This is NOT a freshness signal; do not conflate with the coaching-context data_completeness flags.',
        has_resting_hr: !!s.has_resting_hr,
        has_hrv: !!s.has_hrv,
        has_sleep: !!s.has_sleep,
        has_steps: !!s.has_steps,
      },
      resting_hr: metric(s.resting_hr, 'resting_hr_date'),
      hrv_ms: metric(s.hrv_ms, 'hrv_date'),
      sleep_hours: metric(s.sleep_hours, 'sleep_date'),
      sleep_quality: s.sleep_quality ?? NOT_AVAILABLE,
      steps: s.steps ?? NOT_AVAILABLE,
      active_calories: s.active_calories ?? NOT_AVAILABLE,
      snapshot_sources: s.snapshot_sources ?? NOT_AVAILABLE,
      injury: s.injury_id
        ? {
            injury_id: s.injury_id,
            body_location: s.injury_body_location ?? NOT_AVAILABLE,
            severity: s.injury_severity ?? NOT_AVAILABLE,
            follow_up_due_date: s.injury_follow_up_due_date ?? NOT_AVAILABLE,
            follow_up_overdue: !!s.injury_follow_up_overdue,
            days_since_reported: s.injury_days_since_reported ?? NOT_AVAILABLE,
            follow_up_count: s.injury_follow_up_count ?? NOT_AVAILABLE,
          }
        : NOT_AVAILABLE,
      source: 'athlete_state_snapshot (view); existence flags are last-known-existence, not freshness',
    };
  } catch (e) {
    return err(`get_athlete_state failed: ${e.message}`);
  }
}

// 16. log_nutrition — INSERT one nutrition_logs RAW row (D1: no server-side macro
// maths). Mirrors the app fuel raw-log path (fuel.tsx): meal_type='food',
// parsed=false, so the existing background parse pipeline fills calories/macros.
// Never fabricates nutrition numbers. RISK: low — additive insert, no plan impact.
export async function logNutrition(client, args = {}, opts = {}) {
  const userId = opts.userId || ATHLETE_USER_ID;
  const rawText = args.raw_text;
  if (!rawText || !String(rawText).trim()) {
    return err("raw_text is required (the athlete's own free-text food log)");
  }
  const payload = {
    user_id: userId,
    date: args.date || viennaToday(),
    raw_text: String(rawText),
    meal_type: 'food', // app convention for the raw-log path
    parsed: false, // pipeline parses macros; never computed here (D1)
    logged_at: new Date().toISOString(),
  };
  if (args.meal_timing !== undefined) payload.meal_timing = args.meal_timing; // raw passthrough

  if (args.commit !== true) {
    return proposal('nutrition_logs', 'insert', payload, {
      note: 'raw insert (parsed=false); macros are filled by the existing parse pipeline, never computed here (D1)',
    });
  }
  try {
    const rows = await client.restPost('nutrition_logs', payload);
    return { committed: true, row: rows[0] };
  } catch (e) {
    return err(`log_nutrition failed: ${e.message}`);
  }
}

// 17. regenerate_coaching_take — re-run the COACH'S TAKE for one activity via the
// existing Vercel route api/regenerate-coaching-artifact.js (D2). The morning
// briefing is client-driven and that route rejects it, so it is OUT of scope.
// Idempotent + rate-limited (a recent or in-flight regen is a no-op). Returns the
// REAL regen_status read back from the activity row, never a fabricated 'done'.
// RISK: med — rewrites a stored coaching artifact (prior content kept on error).
const TAKE_REGEN_MIN_INTERVAL_MS = 60 * 1000;
export async function regenerateCoachingTake(client, args = {}, opts = {}) {
  const userId = opts.userId || ATHLETE_USER_ID;
  const activityId = args.activity_id;
  const artifact = args.artifact || 'coach_take';
  if (artifact === 'morning_briefing' || artifact === 'briefing') {
    return err("morning_briefing is client-driven and out of scope; this tool regenerates the Coach's Take only (D2)");
  }
  if (artifact !== 'coach_take') return err(`unsupported artifact: ${artifact} (only coach_take)`);
  if (activityId === undefined || activityId === null) return err('activity_id is required for coach_take');

  let current = null;
  try {
    const rows = await client.restGet(`activities?id=eq.${activityId}&user_id=eq.${userId}&select=id,raw_data`);
    current = rows[0] || null;
  } catch (e) {
    return err(`regenerate_coaching_take precheck failed: ${e.message}`);
  }
  if (!current) return err(`activity ${activityId} not found for this athlete`);
  const raw = current.raw_data && typeof current.raw_data === 'object' ? current.raw_data : {};
  const lastStatus = raw.coach_take_regen_status ?? NOT_AVAILABLE;
  const lastAt = raw.coach_take_regenerated_at ? Date.parse(raw.coach_take_regenerated_at) : null;
  const sinceMs = lastAt ? Date.now() - lastAt : null;
  const inFlight = raw.coach_take_regen_status === 'regenerating';
  const rateLimited = sinceMs !== null && sinceMs < TAKE_REGEN_MIN_INTERVAL_MS;

  if (args.commit !== true) {
    return proposal(
      "activities.raw_data (Coach's Take regen via Vercel)",
      `POST /api/regenerate-coaching-artifact (activity_id=${activityId})`,
      { artifact: 'coach_take', activity_id: activityId },
      {
        current_regen_status: lastStatus,
        would_no_op: inFlight || rateLimited,
        note: 'targets the Vercel route with x-analyze-secret; returns the real regen_status read back from the row',
      }
    );
  }
  if (inFlight || rateLimited) {
    return {
      committed: false,
      rate_limited: true,
      activity_id: activityId,
      regen_status: lastStatus,
      regenerated_at: raw.coach_take_regenerated_at ?? NOT_AVAILABLE,
      note: inFlight
        ? 'a regeneration is already in flight; no-op'
        : `last regen ${Math.round(sinceMs / 1000)}s ago (< ${TAKE_REGEN_MIN_INTERVAL_MS / 1000}s); no-op`,
    };
  }
  try {
    const resp = await client.regenerateCoachingArtifact({
      artifact: 'coach_take',
      activity_id: activityId,
      user_id: userId,
      reason: args.reason ?? 'mcp regenerate_coaching_take',
    });
    // Read the REAL status back from the row (authoritative), falling back to the HTTP body.
    let readback = resp.data?.regen_status ?? NOT_AVAILABLE;
    try {
      const rows = await client.restGet(`activities?id=eq.${activityId}&user_id=eq.${userId}&select=raw_data`);
      const rb = rows[0]?.raw_data;
      if (rb && typeof rb === 'object' && rb.coach_take_regen_status) readback = rb.coach_take_regen_status;
    } catch { /* fall back to HTTP body status */ }
    return {
      committed: resp.ok === true,
      activity_id: activityId,
      target: 'vercel:/api/regenerate-coaching-artifact',
      http_status: resp.status,
      regen_status: readback, // real fresh|error|regenerating — never a fabricated 'done'
      regenerated_at: resp.data?.regenerated_at ?? NOT_AVAILABLE,
      ...(resp.ok ? {} : { error: resp.data?.error || resp.error || `regen route returned ${resp.status}` }),
    };
  } catch (e) {
    return err(`regenerate_coaching_take failed: ${e.message}`);
  }
}

// 18. apply_schedule_change — HIGH BLAST. Commit a USER-CONFIRMED schedule_changes
// row into scheduled_sessions, mirroring the native app's applyProposal
// (app/(tabs)/plan.tsx): reschedule→update planned_date; add→insert status=planned;
// remove→update status='cancelled' (NOT a delete); modify→update fields. Then set
// schedule_changes.status='applied', resolved_at=now(), resolved_by='mcp'.
// PRECONDITION: status IN (approved, accepted); refuses pending/dismissed.
// IDEMPOTENT: an already-applied row is a no-op. commit:true + confirm:true.
// RISK: irreversible plan mutation (a wrong/duplicate session enters the plan).
const APPLY_OK_STATUSES = ['approved', 'accepted'];
const APPLY_CHANGE_TYPES = ['reschedule', 'add', 'remove', 'modify'];
export async function applyScheduleChange(client, args = {}, opts = {}) {
  const userId = opts.userId || ATHLETE_USER_ID;
  const changeId = args.change_id;
  if (changeId === undefined || changeId === null) return err('change_id is required (schedule_changes.id)');

  let change;
  try {
    const rows = await client.restGet(
      `schedule_changes?id=eq.${changeId}&user_id=eq.${userId}` +
        `&select=id,status,change_type,title,reasoning,original_session_id,new_date,new_name,new_notes,` +
        `new_intensity,new_duration_low,new_duration_high,proposed_session,resolved_at,resolved_by`
    );
    change = rows[0];
  } catch (e) {
    return err(`apply_schedule_change lookup failed: ${e.message}`);
  }
  if (!change) return err(`schedule_change ${changeId} not found for this athlete`);

  // IDEMPOTENT: already applied → no-op.
  if (change.status === 'applied') {
    return { committed: false, already_applied: true, schedule_change: change, note: 'already applied; no-op' };
  }
  if (change.status === 'dismissed') {
    return err(`schedule_change ${changeId} is 'dismissed' — refusing to apply a dismissed change`);
  }
  if (!APPLY_OK_STATUSES.includes(change.status)) {
    return err(
      `schedule_change ${changeId} is '${change.status}'; apply requires status IN (approved, accepted). A 'pending' change must be approved by the athlete first.`
    );
  }
  const ct = change.change_type;
  if (!APPLY_CHANGE_TYPES.includes(ct)) {
    return err(`change_type '${ct}' is not applicable to scheduled_sessions (app applies only: ${APPLY_CHANGE_TYPES.join(', ')})`);
  }
  if (ct !== 'add' && (change.original_session_id === null || change.original_session_id === undefined)) {
    return err(`change_type '${ct}' requires original_session_id on the schedule_changes row (MCP does not guess the target by date)`);
  }
  if ((ct === 'reschedule' || ct === 'add') && !change.new_date) {
    return err(`change_type '${ct}' requires new_date`);
  }

  // Build the intended scheduled_sessions mutation (native app parity).
  let plan;
  const where = `id=eq.${change.original_session_id}&user_id=eq.${userId}`;
  if (ct === 'reschedule') {
    plan = { op: 'update', table: 'scheduled_sessions', where, payload: { planned_date: change.new_date } };
  } else if (ct === 'remove') {
    plan = { op: 'update', table: 'scheduled_sessions', where, payload: { status: 'cancelled' } };
  } else if (ct === 'modify') {
    const upd = {};
    if (change.new_duration_low != null) upd.duration_min_low = change.new_duration_low;
    if (change.new_duration_high != null) upd.duration_min_high = change.new_duration_high;
    if (change.new_date) upd.planned_date = change.new_date;
    if (change.new_name) upd.name = change.new_name;
    if (change.new_notes) upd.notes = change.new_notes;
    if (change.new_intensity) upd.intensity = change.new_intensity;
    if (Object.keys(upd).length === 0) return err('modify change has no new_* fields to apply');
    plan = { op: 'update', table: 'scheduled_sessions', where, payload: upd };
  } else {
    // add — build from proposed_session / new_* (app inserts status='planned').
    const ps = change.proposed_session && typeof change.proposed_session === 'object' ? change.proposed_session : {};
    const ins = {
      user_id: userId,
      planned_date: change.new_date,
      name: change.new_name || change.title || ps.name || 'New session',
      session_type: ps.session_type || 'run',
      status: 'planned',
    };
    const durLow = change.new_duration_low ?? ps.duration_min_low;
    if (durLow != null) ins.duration_min_low = durLow;
    if (change.new_duration_high != null) ins.duration_min_high = change.new_duration_high;
    const notes = change.new_notes || ps.notes;
    if (notes) ins.notes = notes;
    plan = { op: 'insert', table: 'scheduled_sessions', payload: ins };
  }

  if (args.commit !== true) {
    return proposal('scheduled_sessions + schedule_changes', `apply change ${changeId} (${ct})`, plan, {
      requires_confirm: true,
      schedule_change_status: change.status,
      note: 'HIGH BLAST: mutates the real plan. Re-send with commit:true AND confirm:true to apply.',
    });
  }
  if (args.confirm !== true) {
    return { committed: false, confirm_required: true, proposed: plan, note: 'HIGH BLAST: set confirm:true (Richard-confirmed) in addition to commit:true.' };
  }
  try {
    let session_rows;
    if (plan.op === 'update') {
      session_rows = await client.restPatch(plan.table, plan.where, plan.payload);
      if (!session_rows || !session_rows.length) {
        return err(`target scheduled_session not found (original_session_id=${change.original_session_id}); nothing applied`);
      }
    } else {
      session_rows = await client.restPost(plan.table, plan.payload);
    }
    const changeRows = await client.restPatch('schedule_changes', `id=eq.${changeId}&user_id=eq.${userId}`, {
      status: 'applied',
      resolved_at: new Date().toISOString(),
      resolved_by: 'mcp',
    });
    return { committed: true, change_type: ct, scheduled_sessions: session_rows, schedule_change: changeRows[0] };
  } catch (e) {
    return err(`apply_schedule_change failed: ${e.message}`);
  }
}

// 19. request_plan_regeneration — HIGH BLAST (intended to regenerate the whole
// plan). Invokes the generate-periodised-plan edge function. VERIFY-FIRST FINDING:
// that function is currently a SKELETON returning 501 { status:'design_pending',
// design_ticket_id, blockers[] } and writes NOTHING — so there is no plan-version
// or row canary yet. This tool INVOKES the real function and returns its REAL
// status verbatim; it NEVER fabricates a 'regenerated' result. IDEMPOTENT +
// RATE-LIMITED via an mcp-plan-regen coaching_memory marker. commit:true + confirm:true.
// RISK: would replace the entire scheduled plan once generation is implemented.
const PLAN_REGEN_MIN_INTERVAL_MS = 10 * 60 * 1000;
export async function requestPlanRegeneration(client, args = {}, opts = {}) {
  const userId = opts.userId || ATHLETE_USER_ID;
  const targetDate = args.target_date || null;
  if (targetDate && !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) return err('target_date must be YYYY-MM-DD');

  let lastAt = null;
  try {
    const rows = await client.restGet(
      `coaching_memory?user_id=eq.${userId}&source=eq.mcp-plan-regen&select=created_at&order=created_at.desc&limit=1`
    );
    if (rows[0]?.created_at) lastAt = Date.parse(rows[0].created_at);
  } catch { /* best-effort */ }
  const sinceMs = lastAt ? Date.now() - lastAt : null;
  const rateLimited = sinceMs !== null && sinceMs < PLAN_REGEN_MIN_INTERVAL_MS;

  if (args.commit !== true) {
    return proposal('generate-periodised-plan (edge fn)', 'invoke full-plan regeneration', { target_date: targetDate, regenerate: true }, {
      requires_confirm: true,
      would_rate_limit: rateLimited,
      backing_function_status: 'SKELETON — currently returns 501 design_pending; NO plan is written yet',
      note: "HIGH BLAST. Re-send with commit:true AND confirm:true. Returns the function's REAL status, never a fabricated completion.",
    });
  }
  if (args.confirm !== true) {
    return { committed: false, confirm_required: true, note: 'HIGH BLAST: set confirm:true (Richard-confirmed) in addition to commit:true.' };
  }
  if (rateLimited) {
    return {
      committed: false,
      rate_limited: true,
      last_requested_at: new Date(lastAt).toISOString(),
      note: `a plan regeneration was requested ${Math.round(sinceMs / 1000)}s ago (< ${PLAN_REGEN_MIN_INTERVAL_MS / 1000}s); no-op`,
    };
  }
  try {
    const resp = await client.callEdgeFunction('generate-periodised-plan', { target_date: targetDate, regenerate: true });
    try {
      await client.restPost(
        'coaching_memory',
        {
          user_id: userId,
          date: viennaToday(),
          type: 'plan_regen',
          category: 'plan',
          source: 'mcp-plan-regen',
          content: JSON.stringify({ target_date: targetDate, http_status: resp.status, status: resp.data?.status ?? null }),
        },
        { onConflict: 'user_id,date,source', merge: true }
      );
    } catch { /* rate-limit marker is best-effort */ }
    const planStatus = resp.data?.status ?? (resp.ok ? 'ok' : 'error');
    const planWritten = planStatus !== 'design_pending' && resp.ok === true;
    return {
      committed: true,
      invoked: true,
      target: 'edge:generate-periodised-plan',
      http_status: resp.status,
      plan_status: planStatus, // REAL status from the function (currently 'design_pending')
      plan_written: planWritten,
      design_ticket_id: resp.data?.design_ticket_id ?? null,
      blockers: resp.data?.blockers ?? null,
      note:
        planStatus === 'design_pending'
          ? 'generate-periodised-plan is a skeleton (501 design_pending) — NO plan was written. Status surfaced verbatim; nothing fabricated.'
          : 'returned the function status verbatim',
    };
  } catch (e) {
    return err(`request_plan_regeneration failed: ${e.message}`);
  }
}

// 20. log_activity — HIGH BLAST. Insert a manual activities row (source='manual',
// enrichment_status='done' per the app's manual-log path, app/log.tsx). CROSS-ROW
// DEDUP runs BEFORE insert: a single session can land as two rows (native-recorded
// + Strava-synced) and enrich-activity dedup does NOT catch cross-row. D3: on a
// suspected duplicate REFUSE and report the matching row(s) — never silently
// create or silently merge. commit:true + confirm:true.
// RISK: a duplicate/incorrect activity pollutes history and feeds coaching.
export async function logActivity(client, args = {}, opts = {}) {
  const userId = opts.userId || ATHLETE_USER_ID;
  const type = args.type ? String(args.type).toLowerCase() : null;
  const date = args.date;
  if (!type) return err('type is required (e.g. run/ride/swim/strength/hike)');
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return err('date is required as YYYY-MM-DD (Europe/Vienna)');
  const distanceKm = args.distance_km != null ? Number(args.distance_km) : null;
  const durationMin = args.duration_min != null ? Number(args.duration_min) : null;

  // ── Cross-row dedup: same Vienna day, then same type (case-insensitive: Strava
  // stores 'Run', manual stores 'run'), then a distance/duration window. ──
  let candidates = [];
  try {
    const loUtc = `${addDaysISO(date, -1)}T00:00:00Z`;
    const hiUtc = `${addDaysISO(date, 1)}T00:00:00Z`;
    const rows = await client.restGet(
      `activities?user_id=eq.${userId}&is_deleted=eq.false&date=gte.${loUtc}&date=lte.${hiUtc}` +
        `&select=id,name,date,type,distance_km,duration_min,source,strava_id&order=date.desc`
    );
    candidates = (rows || []).filter((r) => viennaDateOf(r.date) === date && String(r.type || '').toLowerCase() === type);
  } catch (e) {
    return err(`log_activity dedup precheck failed: ${e.message}`);
  }
  const matches = candidates.filter((r) => {
    if (distanceKm != null && r.distance_km != null) return Math.abs(Number(r.distance_km) - distanceKm) <= 0.5;
    if (durationMin != null && r.duration_min != null) return Math.abs(Number(r.duration_min) - durationMin) <= 10;
    // same day + same type with no comparable distance/duration → still suspicious.
    return true;
  });
  if (matches.length) {
    return {
      committed: false,
      refused: true,
      reason:
        'suspected duplicate (same Vienna day + same type + matching distance/duration). Per D3 this is REFUSED, not merged — a single session often lands as both a native and a Strava row. Confirm/delete the existing row, or adjust, then retry.',
      matching_activities: matches.map((m) => ({
        id: m.id,
        name: m.name,
        date: m.date,
        type: m.type,
        source: m.source,
        strava_id: m.strava_id ?? null,
        distance_km: m.distance_km ?? NOT_AVAILABLE,
        duration_min: m.duration_min ?? NOT_AVAILABLE,
      })),
    };
  }

  const payload = {
    user_id: userId,
    name: args.name || `${type.charAt(0).toUpperCase()}${type.slice(1)}`,
    type,
    date: `${date}T12:00:00Z`, // app convention: midday UTC of the chosen Vienna day
    source: 'manual',
    enrichment_status: 'done', // manual logs are not Strava-enriched (app parity)
    is_deleted: false,
  };
  if (distanceKm != null) payload.distance_km = distanceKm;
  if (durationMin != null) payload.duration_min = durationMin;
  if (args.avg_hr != null) payload.avg_hr = Number(args.avg_hr);
  if (args.elevation_m != null) payload.elevation_m = Number(args.elevation_m);
  if (args.workout_type !== undefined) payload.workout_type = args.workout_type;

  if (args.commit !== true) {
    return proposal('activities', 'insert (source=manual)', payload, {
      requires_confirm: true,
      dedup_checked: true,
      candidates_same_day_same_type: candidates.length,
      note: 'HIGH BLAST: creates an activity. Dedup passed (no same-day/type match). Re-send with commit:true AND confirm:true.',
    });
  }
  if (args.confirm !== true) {
    return { committed: false, confirm_required: true, proposed: payload, note: 'HIGH BLAST: set confirm:true (Richard-confirmed) in addition to commit:true.' };
  }
  try {
    const rows = await client.restPost('activities', payload);
    return { committed: true, row: rows[0] };
  } catch (e) {
    return err(`log_activity failed: ${e.message}`);
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
  {
    name: 'get_nutrition',
    description:
      'Nutrition/fuel logs over a Vienna date range (default last 7 days) with calories/macros + a total alcohol_units tally.',
    fn: getNutrition,
  },
  {
    name: 'get_weekly_review',
    description: 'The most recent generated weekly review text.',
    fn: getWeeklyReview,
  },
  {
    name: 'get_routes',
    description:
      'List the athlete\'s known routes (named locations only); pass route_id for that route\'s coaching context.',
    fn: getRoutes,
  },
  {
    name: 'log_session_feedback',
    description:
      "Records the ATHLETE'S OWN subjective feedback on an activity: raw RPE (1-10), how the legs felt, an injury flag, " +
      "and a free-text note. rpe, feel_legs, injury_flag and notes must be the athlete's verbatim words/values ONLY. " +
      'NEVER infer, estimate, summarise, or generate them from activity metrics (pace, HR, splits, distance, duration) ' +
      'for any sport, and NEVER write a third-person summary of the session into the note. If the athlete has not stated ' +
      'a value, omit that field — do not fill it. Only the fields you supply are written; omitted fields are left ' +
      'untouched (an absent note never overwrites an existing one). If no athlete-provided subjective field is supplied, ' +
      'the tool refuses and writes nothing. Propose-by-default: requires commit:true to write; returns the mutated row ' +
      'plus changed_columns.',
    fn: logSessionFeedback,
  },
  {
    name: 'propose_schedule_change',
    description:
      'Propose a schedule change as a PENDING schedule_changes row (never mutates the plan directly). Propose-by-default: requires commit:true.',
    fn: proposeScheduleChange,
  },
  {
    name: 'write_coaching_memory',
    description:
      'Append/update a coaching memory note (idempotent upsert on user_id,date,source). Propose-by-default: requires commit:true.',
    fn: writeCoachingMemory,
  },
  {
    name: 'update_athlete_profile',
    description:
      'Update athlete profile fields (weight_kg, goal_type, health_notes only; race/goal are deferred). Propose-by-default, confirm each field; requires commit:true. No silent-fill.',
    fn: updateAthleteProfile,
  },
  // ── Phase 3 (power / high blast radius) ──
  {
    name: 'get_athlete_state',
    description:
      'Current athlete_state_snapshot (resting HR, HRV, sleep, steps, active calories, active injury) for the single athlete. Read-only thin view wrap. has_X flags are last-known-EXISTENCE, not freshness. Missing fields are marked NOT AVAILABLE.',
    fn: getAthleteState,
  },
  {
    name: 'log_nutrition',
    description:
      "Log one nutrition entry from the athlete's free text (raw_text). Inserts a RAW nutrition_logs row (meal_type='food', parsed=false); the existing parse pipeline fills calories/macros — this tool NEVER computes or fabricates nutrition numbers. Propose-by-default; requires commit:true; returns the inserted row.",
    fn: logNutrition,
  },
  {
    name: 'regenerate_coaching_take',
    description:
      "Regenerate the COACH'S TAKE for one activity (artifact='coach_take', activity_id required) via the existing Vercel route. The morning briefing is client-driven and is rejected/out of scope. Idempotent + rate-limited; returns the REAL regen_status read back, never a fabricated 'done'. Propose-by-default; requires commit:true.",
    fn: regenerateCoachingTake,
  },
  {
    name: 'apply_schedule_change',
    description:
      "HIGH BLAST. Commit an athlete-approved schedule_changes row (status approved/accepted) into scheduled_sessions, mirroring the app: reschedule→move date, add→insert, remove→status='cancelled', modify→update fields; then mark the change applied. Refuses pending/dismissed; idempotent on already-applied. Requires commit:true AND confirm:true. Returns the mutated session row(s) + the updated change row.",
    fn: applyScheduleChange,
  },
  {
    name: 'request_plan_regeneration',
    description:
      "HIGH BLAST. Invoke the generate-periodised-plan edge function to regenerate the whole plan. Idempotent + rate-limited. Returns the function's REAL status verbatim (currently a skeleton → 'design_pending', no plan written) — never a fabricated completion. Requires commit:true AND confirm:true.",
    fn: requestPlanRegeneration,
  },
  {
    name: 'log_activity',
    description:
      "HIGH BLAST. Create a manual activities row (source='manual'). Runs CROSS-ROW dedup first (same Vienna day + same type + matching distance/duration, case-insensitive) and REFUSES a suspected duplicate with a report rather than creating or merging it. Requires commit:true AND confirm:true. Returns the inserted row.",
    fn: logActivity,
  },
];
