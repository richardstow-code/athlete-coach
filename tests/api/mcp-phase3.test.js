// mcp-phase3.test.js — GATE-3 tests for the Phase-3 power tools (AC-157).
//
// LAYER 1 (always, no network): deterministic mock-client tests asserting the
// REAL mutation/payload/edge-call each tool issues (not just a 200) — dedup
// refusal, propose/commit/confirm gating, idempotency, rate-limiting, raw-only
// nutrition, the real (non-fabricated) plan-regen status, and the verbatim-only
// regen target. The live end-to-end per-HIGH-BLAST-tool flow is the MANUAL
// production GATE (Architect/Richard), recorded in HANDOVER.md — not run here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getAthleteState,
  logNutrition,
  regenerateCoachingTake,
  applyScheduleChange,
  requestPlanRegeneration,
  logActivity,
  TOOLS,
  NOT_AVAILABLE,
} from '../../api/_mcpTools.js';
import { buildServer } from '../../api/mcp.js';

const UID = '40cfe68e-faea-491c-b410-0093572f02d6';

function mockClient({ handlers = [], postReturn, patchReturn, edgeReturn, regenReturn } = {}) {
  const calls = { rest: [], post: [], patch: [], edge: [], regen: [] };
  return {
    calls,
    async callRPC() { return { ok: true, status: 200, data: null }; },
    async restGet(path) {
      calls.rest.push(path);
      for (const [re, val] of handlers) if (re.test(path)) return typeof val === 'function' ? val(path) : val;
      return [];
    },
    async restPost(table, body, opts) {
      calls.post.push({ table, body, opts });
      if (postReturn !== undefined) return typeof postReturn === 'function' ? postReturn(table, body) : postReturn;
      return [{ id: 1001, ...(Array.isArray(body) ? body[0] : body) }];
    },
    async restPatch(table, query, body) {
      calls.patch.push({ table, query, body });
      if (patchReturn !== undefined) return typeof patchReturn === 'function' ? patchReturn(table, query, body) : patchReturn;
      return [{ id: 55, ...body }];
    },
    async callEdgeFunction(slug, body) {
      calls.edge.push({ slug, body });
      return edgeReturn ?? { ok: false, status: 501, data: { status: 'design_pending', design_ticket_id: '8933a7c4', blockers: ['mesocycle structure'] } };
    },
    async regenerateCoachingArtifact(body) {
      calls.regen.push({ body });
      return regenReturn ?? { ok: true, status: 200, data: { ok: true, regen_status: 'fresh', regenerated_at: '2026-06-22T05:00:00Z' } };
    },
  };
}

// ───────────────────────── get_athlete_state (R) ───────────────────────────

test('get_athlete_state: maps the view; null fields -> NOT AVAILABLE; existence flags labelled', async () => {
  const c = mockClient({ handlers: [[/^athlete_state_snapshot/, [{
    snapshot_date: '2026-06-21',
    resting_hr: 46, resting_hr_date: '2026-06-20', has_resting_hr: true,
    hrv_ms: null, hrv_date: null, has_hrv: false,
    sleep_hours: 7.5, sleep_date: '2026-06-20', has_sleep: true,
    steps: null, active_calories: null, has_steps: false,
    snapshot_sources: {}, injury_id: null,
  }]]] });
  const r = await getAthleteState(c, {}, { userId: UID });
  assert.equal(r.resting_hr.value, 46);
  assert.equal(r.hrv_ms, NOT_AVAILABLE, 'null metric -> NOT AVAILABLE');
  assert.equal(r.steps, NOT_AVAILABLE);
  assert.equal(r.injury, NOT_AVAILABLE);
  assert.equal(r.existence_flags.has_hrv, false);
  assert.match(r.existence_flags._meaning, /EVER been recorded/i);
  assert.match(r.existence_flags._meaning, /not a freshness/i);
  assert.match(r.source, /last-known-existence/);
});

test('get_athlete_state: no snapshot row -> NOT AVAILABLE (no fabrication)', async () => {
  const c = mockClient({ handlers: [[/^athlete_state_snapshot/, []]] });
  const r = await getAthleteState(c, {}, { userId: UID });
  assert.equal(r.state, NOT_AVAILABLE);
});

// ───────────────────────── log_nutrition (W, low) ──────────────────────────

test('log_nutrition: commit inserts a RAW row (parsed=false, meal_type=food, no macros)', async () => {
  const c = mockClient({});
  const prop = await logNutrition(c, { raw_text: 'porridge and banana' }, { userId: UID });
  assert.equal(prop.committed, false);
  assert.equal(c.calls.post.length, 0, 'propose does not write');

  const done = await logNutrition(c, { raw_text: 'porridge and banana', meal_timing: 'breakfast', commit: true }, { userId: UID });
  assert.equal(done.committed, true);
  const body = c.calls.post[0].body;
  assert.equal(body.raw_text, 'porridge and banana');
  assert.equal(body.meal_type, 'food');
  assert.equal(body.parsed, false);
  assert.equal(body.meal_timing, 'breakfast');
  assert.ok(!('calories' in body) && !('protein_g' in body) && !('carbs_g' in body), 'no fabricated macros');
});

test('log_nutrition: requires raw_text', async () => {
  const c = mockClient({});
  assert.ok((await logNutrition(c, { commit: true }, { userId: UID }).then((r) => r.error)));
  assert.equal(c.calls.post.length, 0);
});

// ──────────────────── regenerate_coaching_take (W, med) ─────────────────────

test('regenerate_coaching_take: rejects morning_briefing (out of scope, D2)', async () => {
  const c = mockClient({});
  const r = await regenerateCoachingTake(c, { activity_id: 362, artifact: 'morning_briefing', commit: true }, { userId: UID });
  assert.match(r.error, /morning_briefing/);
  assert.equal(c.calls.regen.length, 0);
});

test('regenerate_coaching_take: targets the Vercel route and returns the REAL regen_status', async () => {
  const c = mockClient({
    handlers: [[/^activities\?id=eq\.362/, [{ id: 362, raw_data: {} }]]],
    regenReturn: { ok: true, status: 200, data: { ok: true, regen_status: 'fresh', regenerated_at: '2026-06-22T05:00:00Z' } },
  });
  const done = await regenerateCoachingTake(c, { activity_id: 362, commit: true }, { userId: UID });
  assert.equal(c.calls.regen.length, 1, 'invoked the Vercel regen route');
  assert.equal(done.target, 'vercel:/api/regenerate-coaching-artifact');
  assert.equal(done.regen_status, 'fresh');
  assert.equal(done.committed, true);
  assert.notEqual(done.regen_status, 'done', 'never a fabricated done');
});

test('regenerate_coaching_take: a recent regen is rate-limited (no-op, no route call)', async () => {
  const recent = new Date().toISOString();
  const c = mockClient({ handlers: [[/^activities\?id=eq\.362/, [{ id: 362, raw_data: { coach_take_regen_status: 'fresh', coach_take_regenerated_at: recent } }]]] });
  const r = await regenerateCoachingTake(c, { activity_id: 362, commit: true }, { userId: UID });
  assert.equal(r.committed, false);
  assert.equal(r.rate_limited, true);
  assert.equal(c.calls.regen.length, 0, 'no regen fired within the rate-limit window');
});

// ─────────────────── apply_schedule_change (W, HIGH) ────────────────────────

function changeRow(over = {}) {
  return { id: 7, status: 'approved', change_type: 'reschedule', title: 'Move long run', original_session_id: 55, new_date: '2026-06-28', ...over };
}

test('apply_schedule_change: refuses pending and dismissed; commits only approved/accepted', async () => {
  const cP = mockClient({ handlers: [[/^schedule_changes\?id=eq\.7/, [changeRow({ status: 'pending' })]]] });
  const rP = await applyScheduleChange(cP, { change_id: 7, commit: true, confirm: true }, { userId: UID });
  assert.match(rP.error, /approved, accepted/);
  assert.equal(cP.calls.patch.length, 0, 'pending: nothing mutated');

  const cD = mockClient({ handlers: [[/^schedule_changes\?id=eq\.7/, [changeRow({ status: 'dismissed' })]]] });
  const rD = await applyScheduleChange(cD, { change_id: 7, commit: true, confirm: true }, { userId: UID });
  assert.match(rD.error, /dismissed/);
  assert.equal(cD.calls.patch.length, 0);
});

test('apply_schedule_change: requires confirm:true on top of commit:true', async () => {
  const c = mockClient({ handlers: [[/^schedule_changes\?id=eq\.7/, [changeRow()]]] });
  const r = await applyScheduleChange(c, { change_id: 7, commit: true }, { userId: UID });
  assert.equal(r.confirm_required, true);
  assert.equal(c.calls.patch.length, 0, 'no mutation without confirm');
});

test('apply_schedule_change: reschedule ACTUALLY mutates scheduled_sessions + marks change applied(mcp)', async () => {
  const c = mockClient({
    handlers: [[/^schedule_changes\?id=eq\.7/, [changeRow()]]],
    patchReturn: (table) => (table === 'scheduled_sessions' ? [{ id: 55, planned_date: '2026-06-28' }] : [{ id: 7, status: 'applied' }]),
  });
  const done = await applyScheduleChange(c, { change_id: 7, commit: true, confirm: true }, { userId: UID });
  assert.equal(done.committed, true);
  const ss = c.calls.patch.find((p) => p.table === 'scheduled_sessions');
  assert.equal(ss.body.planned_date, '2026-06-28', 'planned_date moved on the real row');
  const sc = c.calls.patch.find((p) => p.table === 'schedule_changes');
  assert.equal(sc.body.status, 'applied');
  assert.equal(sc.body.resolved_by, 'mcp');
  assert.ok(sc.body.resolved_at);
});

test('apply_schedule_change: remove sets status=cancelled (NOT a delete)', async () => {
  const c = mockClient({
    handlers: [[/^schedule_changes\?id=eq\.7/, [changeRow({ change_type: 'remove', new_date: null })]]],
    patchReturn: (table) => (table === 'scheduled_sessions' ? [{ id: 55, status: 'cancelled' }] : [{ id: 7, status: 'applied' }]),
  });
  const done = await applyScheduleChange(c, { change_id: 7, commit: true, confirm: true }, { userId: UID });
  assert.equal(done.committed, true);
  const ss = c.calls.patch.find((p) => p.table === 'scheduled_sessions');
  assert.equal(ss.body.status, 'cancelled');
});

test('apply_schedule_change: add inserts a planned session', async () => {
  const c = mockClient({
    handlers: [[/^schedule_changes\?id=eq\.7/, [changeRow({ change_type: 'add', original_session_id: null, new_name: 'Easy 5k', proposed_session: { session_type: 'run', notes: 'shake out' } })]]],
  });
  const done = await applyScheduleChange(c, { change_id: 7, commit: true, confirm: true }, { userId: UID });
  assert.equal(done.committed, true);
  assert.equal(c.calls.post[0].table, 'scheduled_sessions');
  assert.equal(c.calls.post[0].body.status, 'planned');
  assert.equal(c.calls.post[0].body.name, 'Easy 5k');
  assert.equal(c.calls.post[0].body.session_type, 'run');
});

test('apply_schedule_change: already-applied is an idempotent no-op', async () => {
  const c = mockClient({ handlers: [[/^schedule_changes\?id=eq\.7/, [changeRow({ status: 'applied' })]]] });
  const r = await applyScheduleChange(c, { change_id: 7, commit: true, confirm: true }, { userId: UID });
  assert.equal(r.committed, false);
  assert.equal(r.already_applied, true);
  assert.equal(c.calls.patch.length, 0, 'no mutation on re-apply');
  assert.equal(c.calls.post.length, 0);
});

// ─────────────────── request_plan_regeneration (W, HIGH) ────────────────────

test('request_plan_regeneration: returns the REAL design_pending status, never a fabricated done', async () => {
  const c = mockClient({ handlers: [[/^coaching_memory/, []]] });
  const noConfirm = await requestPlanRegeneration(c, { commit: true }, { userId: UID });
  assert.equal(noConfirm.confirm_required, true);
  assert.equal(c.calls.edge.length, 0);

  const done = await requestPlanRegeneration(c, { commit: true, confirm: true }, { userId: UID });
  assert.equal(c.calls.edge[0].slug, 'generate-periodised-plan', 'invoked the real edge function');
  assert.equal(done.plan_status, 'design_pending');
  assert.equal(done.plan_written, false, 'does not claim a plan was written');
  assert.notEqual(done.plan_status, 'done');
});

test('request_plan_regeneration: a rapid repeat is rate-limited (no second invoke)', async () => {
  const recent = new Date().toISOString();
  const c = mockClient({ handlers: [[/^coaching_memory/, [{ created_at: recent }]]] });
  const r = await requestPlanRegeneration(c, { commit: true, confirm: true }, { userId: UID });
  assert.equal(r.rate_limited, true);
  assert.equal(c.calls.edge.length, 0, 'rate-limited: did not invoke the edge function');
});

// ───────────────────────── log_activity (W, HIGH) ──────────────────────────

test('log_activity: cross-row duplicate (Strava-shaped, same day/type/distance) is REFUSED, not inserted (D3)', async () => {
  // Existing native/Strava row for the same session; attempt the cross-row duplicate.
  const c = mockClient({ handlers: [[/^activities\?user_id/, [
    { id: 362, name: 'Afternoon Run', date: '2026-06-21T13:00:00Z', type: 'Run', distance_km: 23.3, duration_min: 137, source: 'strava', strava_id: 190120 },
  ]]] });
  const r = await logActivity(c, { type: 'run', date: '2026-06-21', distance_km: 23.3, duration_min: 137, commit: true, confirm: true }, { userId: UID });
  assert.equal(r.refused, true);
  assert.notEqual(r.committed, true);
  assert.equal(c.calls.post.length, 0, 'duplicate NOT inserted (no merge, no blind insert)');
  assert.equal(r.matching_activities[0].id, 362, 'reports the matching row');
});

test('log_activity: no match -> propose, then commit+confirm inserts source=manual', async () => {
  const c = mockClient({ handlers: [[/^activities\?user_id/, []]] });
  const prop = await logActivity(c, { type: 'swim', date: '2026-06-22', distance_km: 2 }, { userId: UID });
  assert.equal(prop.committed, false);
  assert.equal(c.calls.post.length, 0);

  const needConfirm = await logActivity(c, { type: 'swim', date: '2026-06-22', distance_km: 2, commit: true }, { userId: UID });
  assert.equal(needConfirm.confirm_required, true);
  assert.equal(c.calls.post.length, 0, 'no insert without confirm');

  const done = await logActivity(c, { type: 'swim', date: '2026-06-22', distance_km: 2, commit: true, confirm: true }, { userId: UID });
  assert.equal(done.committed, true);
  const body = c.calls.post[0].body;
  assert.equal(body.source, 'manual');
  assert.equal(body.type, 'swim');
  assert.equal(body.date, '2026-06-22T12:00:00Z');
  assert.equal(body.enrichment_status, 'done');
});

// ───────────────────────── SDK wiring ──────────────────────────────────────

test('buildServer wires all 20 tools (14 + 6 Phase 3) without throwing', () => {
  assert.doesNotThrow(() => buildServer(mockClient({})));
  assert.equal(TOOLS.length, 20);
  for (const n of ['get_athlete_state', 'log_nutrition', 'regenerate_coaching_take', 'apply_schedule_change', 'request_plan_regeneration', 'log_activity']) {
    assert.ok(TOOLS.find((t) => t.name === n), `registered ${n}`);
  }
});
