// mcp-phase2.test.js — GATE-2 tests for the Phase-2 MCP tools.
//
// LAYER 1 (always, no network): propose-by-default + commit gating, no-silent-
// fill, propose-not-mutate (schedule), raw-rpe passthrough, age_days, the
// compliance_score field, NOT AVAILABLE markers, idempotency-by-construction.
// LAYER 2 (gated on TEST_SUPABASE_*): live seed + read-back / idempotency / no-
// silent-fill against the test project (activities, athlete_settings,
// coaching_memory, nutrition_logs, schedule_changes are present there).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import {
  getRecentActivities,
  getActivityDetail,
  getRecovery,
  getNutrition,
  getWeeklyReview,
  getRoutes,
  logSessionFeedback,
  proposeScheduleChange,
  writeCoachingMemory,
  updateAthleteProfile,
  NOT_AVAILABLE,
  daysSince,
  viennaToday,
} from '../../api/_mcpTools.js';
import { buildServer } from '../../api/mcp.js';
import { makeSupabaseRest } from '../../api/_supabaseRest.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: join(__dirname, '../.env.test') });

function mockClient({ rpcData = null, handlers = [], postReturn, patchReturn } = {}) {
  const calls = { rest: [], rpc: [], post: [], patch: [] };
  return {
    calls,
    async callRPC(fn, body) { calls.rpc.push({ fn, body }); return { ok: true, status: 200, data: rpcData }; },
    async restGet(path) {
      calls.rest.push(path);
      for (const [re, val] of handlers) if (re.test(path)) return typeof val === 'function' ? val(path) : val;
      return [];
    },
    async restPost(table, body, opts) {
      calls.post.push({ table, body, opts });
      if (postReturn !== undefined) return typeof postReturn === 'function' ? postReturn(table, body) : postReturn;
      return [{ id: 999, ...(Array.isArray(body) ? body[0] : body) }];
    },
    async restPatch(table, query, body) {
      calls.patch.push({ table, query, body });
      if (patchReturn !== undefined) return patchReturn;
      return [{ id: 1, ...body }];
    },
  };
}

// ───────────────────────── LAYER 1 — reads ────────────────────────────────

test('get_recent_activities surfaces compliance_score (NOT AVAILABLE when null)', async () => {
  const c = mockClient({ handlers: [[/^activities/, [
    { id: 1, date: '2026-06-20T10:00:00Z', type: 'Run', compliance_score: 8.5 },
    { id: 2, date: '2026-06-20T10:00:00Z', type: 'Run', compliance_score: null },
  ]]] });
  const r = await getRecentActivities(c, { from: '2026-06-19', to: '2026-06-21' }, { userId: 'u' });
  assert.ok(/compliance_score/.test(c.calls.rest[0]), 'selects compliance_score');
  const byId = Object.fromEntries(r.activities.map((a) => [a.id, a.compliance_score]));
  assert.equal(byId[1], 8.5);
  assert.equal(byId[2], NOT_AVAILABLE);
});

test('get_activity_detail surfaces compliance_score/grade/summary', async () => {
  const c = mockClient({ handlers: [
    [/^activities\?id=eq\.5/, [{ id: 5, type: 'Run', workout_type: '', date: '2026-06-10T08:00:00Z', compliance_score: 7, compliance_grade: 'B', compliance_summary: 'solid' }]],
    [/^activities\?user_id/, [{ id: 5, date: '2026-06-10T08:00:00Z' }]],
    [/^intervals_data/, []],
  ] });
  const r = await getActivityDetail(c, { activity_id: 5 }, { userId: 'u' });
  assert.equal(r.compliance_score, 7);
  assert.equal(r.compliance_grade, 'B');
  assert.equal(r.compliance_summary, 'solid');
});

test('get_recovery adds age_days per metric; null sleep_quality -> NOT AVAILABLE', async () => {
  const today = viennaToday();
  const snap = {
    has_resting_hr: true, resting_hr: 46, resting_hr_date: '2026-06-19',
    has_hrv: true, hrv_ms: 66, hrv_date: '2026-06-07',
    has_sleep: true, sleep_hours: 8.2, sleep_quality: null, sleep_date: '2026-06-06',
    snapshot_date: '2026-06-19', snapshot_sources: {},
  };
  const c = mockClient({ handlers: [
    [/^athlete_state_snapshot/, [snap]],
    [/^intervals_data/, [{ date: '2026-06-19', ctl: 43, atl: 52, tsb: -9 }]],
  ] });
  const r = await getRecovery(c, {}, { userId: 'u' });
  assert.equal(r.recovery.resting_hr.age_days, daysSince('2026-06-19', today));
  assert.equal(r.recovery.hrv.age_days, daysSince('2026-06-07', today));
  assert.equal(r.recovery.sleep.age_days, daysSince('2026-06-06', today));
  assert.equal(r.recovery.sleep.quality, NOT_AVAILABLE);
});

test('get_nutrition tallies alcohol_units across the range', async () => {
  const c = mockClient({ handlers: [[/^nutrition_logs/, [
    { id: 1, date: '2026-06-20', meal_name: 'Beer', alcohol_units: 2.3 },
    { id: 2, date: '2026-06-21', meal_name: 'Wine', alcohol_units: 1.2 },
    { id: 3, date: '2026-06-21', meal_name: 'Oats', alcohol_units: null },
  ]]] });
  const r = await getNutrition(c, { from: '2026-06-20', to: '2026-06-21' }, { userId: 'u' });
  assert.equal(r.count, 3);
  assert.equal(r.alcohol_units_total, 3.5);
});

test('get_weekly_review returns latest content (or NOT AVAILABLE)', async () => {
  const c1 = mockClient({ handlers: [[/^coaching_memory/, [{ date: '2026-06-15', content: 'Great week', created_at: 'x' }]]] });
  assert.equal((await getWeeklyReview(c1, {}, { userId: 'u' })).weekly_review, 'Great week');
  const c2 = mockClient({ handlers: [[/^coaching_memory/, []]] });
  assert.equal((await getWeeklyReview(c2, {}, { userId: 'u' })).weekly_review, NOT_AVAILABLE);
});

test('get_routes: list omits raw coords; route_id wraps the RPC', async () => {
  const c1 = mockClient({ handlers: [[/^athlete_routes/, [{ id: 'r1', name: 'River loop' }]]] });
  await getRoutes(c1, {}, { userId: 'u' });
  assert.ok(!/start_lat|start_lng/.test(c1.calls.rest[0]), 'no raw coords selected');
  const c2 = mockClient({ rpcData: { route: 'ctx' } });
  const r2 = await getRoutes(c2, { route_id: 'r1' }, { userId: 'u' });
  assert.equal(c2.calls.rpc[0].fn, 'get_route_coach_context');
  assert.deepEqual(r2.route_coach_context, { route: 'ctx' });
});

// ───────────────────────── LAYER 1 — writes (propose/commit) ───────────────

test('log_session_feedback: propose-by-default does NOT write; commit writes raw rpe', async () => {
  const c = mockClient({});
  const prop = await logSessionFeedback(c, { activity_id: 5, rpe: 7, feel_legs: 'heavy' }, { userId: 'u' });
  assert.equal(prop.committed, false);
  assert.equal(c.calls.patch.length, 0, 'no DB write without commit');
  assert.equal(prop.proposed.payload.rpe, 7);
  assert.ok(!('feel_score' in prop.proposed.payload), 'never a feel_score');

  const done = await logSessionFeedback(c, { activity_id: 5, rpe: 7, commit: true }, { userId: 'u' });
  assert.equal(done.committed, true);
  assert.equal(c.calls.patch[0].table, 'activities');
  assert.equal(c.calls.patch[0].body.rpe, 7); // RAW passthrough
  assert.ok(c.calls.patch[0].body.subjective_captured_at);
});

test('log_session_feedback rejects a non-raw rpe (0/11/non-int)', async () => {
  const c = mockClient({});
  assert.ok((await logSessionFeedback(c, { activity_id: 5, rpe: 0, commit: true }, {})).error);
  assert.ok((await logSessionFeedback(c, { activity_id: 5, rpe: 11, commit: true }, {})).error);
  assert.ok((await logSessionFeedback(c, { activity_id: 5, rpe: 7.5, commit: true }, {})).error);
  assert.equal(c.calls.patch.length, 0);
});

// ── AC-153 fabrication guardrail (the regression that destroyed a real note) ──
// Synthetic activity id (NEVER 362, which is Richard's real run).
const AC153_ID = 424242;

test('AC-153 TEST 1 — refuse-when-empty: no subjective fields => no write + refusal (propose AND commit)', async () => {
  const c = mockClient({});
  // propose (commit:false)
  const prop = await logSessionFeedback(c, { activity_id: AC153_ID }, { userId: 'u' });
  assert.equal(prop.committed, false);
  assert.equal(prop.refused, true);
  assert.match(prop.error, /No athlete-provided subjective values/);
  assert.equal(c.calls.patch.length, 0, 'propose with no fields writes nothing');
  // commit:true with no subjective fields must ALSO be a no-op (this is the regression-catcher)
  const done = await logSessionFeedback(c, { activity_id: AC153_ID, commit: true }, { userId: 'u' });
  assert.notEqual(done.committed, true);
  assert.equal(done.refused, true);
  assert.equal(c.calls.patch.length, 0, 'commit with no fields still writes nothing');
});

test('AC-153 TEST 2 — partial update: rpe-only never sends subjective_notes (existing note preserved)', async () => {
  const c = mockClient({});
  const done = await logSessionFeedback(c, { activity_id: AC153_ID, rpe: 2, commit: true }, { userId: 'u' });
  assert.equal(done.committed, true);
  const body = c.calls.patch[0].body;
  assert.equal(body.rpe, 2);
  assert.ok(!('subjective_notes' in body), 'absent note column never sent => PATCH leaves the DB note untouched');
  assert.ok(!('feel_legs' in body), 'no silent-fill of feel_legs');
  assert.ok(!('injury_flag' in body), 'no silent-fill of injury_flag');
  assert.deepEqual(done.changed_columns, ['rpe'], 'reports only the column it changed');
  assert.ok(body.subjective_captured_at, 'capture timestamp stamped on a real write');
});

test('AC-153 TEST 4 — dry-run: propose with values mutates nothing; notes maps to subjective_notes', async () => {
  const c = mockClient({});
  const prop = await logSessionFeedback(
    c,
    { activity_id: AC153_ID, rpe: 2, feel_legs: 'normal', injury_flag: 'nothing', notes: 'Hot day, kept it Z2 and so was ok.' },
    { userId: 'u' }
  );
  assert.equal(prop.committed, false);
  assert.equal(c.calls.patch.length, 0, 'propose never writes');
  assert.equal(prop.proposed.payload.subjective_notes, 'Hot day, kept it Z2 and so was ok.', 'notes -> subjective_notes column');
  assert.ok(!('notes' in prop.proposed.payload), 'never writes a non-existent "notes" column');
  assert.deepEqual(prop.changed_columns, ['rpe', 'feel_legs', 'injury_flag', 'subjective_notes']);
  assert.ok(!('updated_at' in prop.proposed.payload), 'activities has no updated_at column');
});

test('propose_schedule_change: writes a pending schedule_changes row, NEVER scheduled_sessions', async () => {
  const c = mockClient({});
  const base = { change_type: 'reschedule', title: 'Move long run', reasoning: 'travel', new_date: '2026-06-25' };
  const prop = await proposeScheduleChange(c, base, { userId: 'u' });
  assert.equal(prop.committed, false);
  assert.equal(c.calls.post.length, 0);

  const done = await proposeScheduleChange(c, { ...base, commit: true }, { userId: 'u' });
  assert.equal(done.committed, true);
  assert.equal(c.calls.post.length, 1);
  assert.equal(c.calls.post[0].table, 'schedule_changes');
  assert.equal(c.calls.post[0].body.status, 'pending');
  assert.equal(c.calls.post[0].body.proposed_by, 'mcp');
  // the cardinal guarantee: nothing ever touches scheduled_sessions
  assert.ok(c.calls.post.every((p) => p.table !== 'scheduled_sessions'));
  assert.ok(c.calls.patch.every((p) => p.table !== 'scheduled_sessions'));
});

test('write_coaching_memory: commit upserts onConflict (user_id,date,source)', async () => {
  const c = mockClient({});
  const prop = await writeCoachingMemory(c, { source: 'mcp', content: 'note' }, { userId: 'u' });
  assert.equal(prop.committed, false);
  assert.equal(c.calls.post.length, 0);
  await writeCoachingMemory(c, { source: 'mcp', content: 'note', commit: true }, { userId: 'u' });
  assert.equal(c.calls.post[0].opts.onConflict, 'user_id,date,source');
  assert.equal(c.calls.post[0].opts.merge, true);
});

test('update_athlete_profile: no silent-fill — rejects unknown fields, commit gates write', async () => {
  const c = mockClient({});
  // unknown/deferred field is rejected, not written
  const prop = await updateAthleteProfile(c, { weight_kg: 78, goal_pace: '4:00', race_date: '2026-10-12' }, { userId: 'u' });
  assert.equal(prop.committed, false);
  assert.deepEqual(prop.proposed.fields, { weight_kg: 78 });
  assert.ok(prop.rejected_fields.includes('goal_pace'));
  assert.ok(prop.rejected_fields.includes('race_date'));
  assert.equal(c.calls.post.length, 0, 'nothing written without commit');

  // only-disallowed-fields => error, no write
  const onlyBad = await updateAthleteProfile(c, { goal_pace: '4:00', commit: true }, { userId: 'u' });
  assert.ok(onlyBad.error);
  assert.equal(c.calls.post.length, 0);

  // commit writes ONLY the allowed field
  const done = await updateAthleteProfile(c, { weight_kg: 78, race_date: '2026-10-12', commit: true }, { userId: 'u' });
  assert.equal(done.committed, true);
  const settingsPost = c.calls.post.find((p) => p.table === 'athlete_settings');
  assert.equal(settingsPost.body.weight_kg, 78);
  assert.ok(!('race_date' in settingsPost.body), 'deferred column never written');
});

test('buildServer wires all 14 tools without throwing', () => {
  assert.doesNotThrow(() => buildServer(mockClient({})));
});

// ───────────────────────── LAYER 2 — live (gated) ─────────────────────────

const TEST_URL = process.env.TEST_SUPABASE_URL || '';
const TEST_KEY = process.env.TEST_SUPABASE_SERVICE_KEY || '';
const PROD_ID = 'yjuhzmknabedjklsgbje';
const layer2 = !!TEST_KEY && !!TEST_URL && !TEST_URL.includes(PROD_ID);
const skip = !layer2 && 'TEST_SUPABASE_* not set (or points at prod)';
const UID = '00000000-0000-4000-8000-0000000000b2'; // phase-2 synthetic athlete

async function db() { const { createClient } = await import('@supabase/supabase-js'); return createClient(TEST_URL, TEST_KEY, { auth: { persistSession: false } }); }
function client() { return makeSupabaseRest({ baseUrl: TEST_URL, serviceKey: TEST_KEY }); }

test('PARITY: get_nutrition alcohol tally == direct sum (test project)', { skip }, async () => {
  const d = await db();
  await d.from('nutrition_logs').delete().eq('user_id', UID);
  try {
    const ins = await d.from('nutrition_logs').insert([
      { user_id: UID, date: '2026-06-20', meal_name: 'Beer', alcohol_units: 2.0 },
      { user_id: UID, date: '2026-06-21', meal_name: 'Wine', alcohol_units: 1.5 },
    ]);
    assert.equal(ins.error, null, ins.error?.message);
    const r = await getNutrition(client(), { from: '2026-06-01', to: '2026-06-30' }, { userId: UID });
    assert.equal(r.count, 2);
    assert.equal(r.alcohol_units_total, 3.5);
  } finally { await d.from('nutrition_logs').delete().eq('user_id', UID); }
});

test('WRITE+READBACK: log_session_feedback mutates the activity row', { skip }, async () => {
  const d = await db();
  await d.from('activities').delete().eq('user_id', UID);
  try {
    const ins = await d.from('activities').insert({ user_id: UID, name: 'Test Run', type: 'Run', date: '2026-06-21T08:00:00Z', is_deleted: false }).select('id').single();
    assert.equal(ins.error, null, ins.error?.message);
    const id = ins.data.id;
    const done = await logSessionFeedback(client(), { activity_id: id, rpe: 6, feel_legs: 'good', notes: 'felt strong', commit: true }, { userId: UID });
    assert.equal(done.committed, true);
    const { data } = await d.from('activities').select('rpe,feel_legs,subjective_notes,subjective_captured_at').eq('id', id).single();
    assert.equal(data.rpe, 6);
    assert.equal(data.feel_legs, 'good');
    assert.equal(data.subjective_notes, 'felt strong');
    assert.ok(data.subjective_captured_at, 'capture timestamp set');
  } finally { await d.from('activities').delete().eq('user_id', UID); }
});

test('AC-153 TEST 3 (live) — happy path: verbatim values, UPDATE not INSERT (created_at unchanged), capture stamped', { skip }, async () => {
  const d = await db();
  await d.from('activities').delete().eq('user_id', UID);
  try {
    const note = 'Very hot day but kept it zone 2 and so was ok. Legs a touch tired from hiking.';
    const ins = await d.from('activities')
      .insert({ user_id: UID, name: 'Test Run', type: 'Run', date: '2026-06-21T08:00:00Z', is_deleted: false })
      .select('id,created_at').single();
    assert.equal(ins.error, null, ins.error?.message);
    const { id, created_at } = ins.data;
    const done = await logSessionFeedback(
      client(),
      { activity_id: id, rpe: 2, feel_legs: 'normal', injury_flag: 'nothing', notes: note, commit: true },
      { userId: UID }
    );
    assert.equal(done.committed, true);
    assert.deepEqual([...done.changed_columns].sort(), ['feel_legs', 'injury_flag', 'rpe', 'subjective_notes']);
    const { data } = await d.from('activities')
      .select('rpe,feel_legs,injury_flag,subjective_notes,subjective_captured_at,created_at').eq('id', id).single();
    assert.equal(data.rpe, 2);
    assert.equal(data.feel_legs, 'normal');
    assert.equal(data.injury_flag, 'nothing');
    assert.equal(data.subjective_notes, note, 'note stored byte-for-byte — no summarisation/drift');
    assert.ok(data.subjective_captured_at, 'capture timestamp set');
    assert.equal(data.created_at, created_at, 'UPDATE not duplicate-INSERT — created_at unchanged');
  } finally { await d.from('activities').delete().eq('user_id', UID); }
});

test('AC-153 TEST 2 (live) — rpe-only update preserves an existing note byte-for-byte', { skip }, async () => {
  const d = await db();
  await d.from('activities').delete().eq('user_id', UID);
  try {
    const realNote = "Very hot day but tried to keep it zone 2 and so was ok. Could tell I'd hiked the last two days but otherwise legs were ok";
    const ins = await d.from('activities')
      .insert({ user_id: UID, name: 'Test Run', type: 'Run', date: '2026-06-21T08:00:00Z', is_deleted: false, rpe: 2, feel_legs: 'normal', injury_flag: 'nothing', subjective_notes: realNote })
      .select('id').single();
    assert.equal(ins.error, null, ins.error?.message);
    const id = ins.data.id;
    // Caller supplies ONLY rpe — the note/feel/injury must survive untouched.
    const done = await logSessionFeedback(client(), { activity_id: id, rpe: 4, commit: true }, { userId: UID });
    assert.equal(done.committed, true);
    assert.deepEqual(done.changed_columns, ['rpe']);
    const { data } = await d.from('activities').select('rpe,feel_legs,injury_flag,subjective_notes').eq('id', id).single();
    assert.equal(data.rpe, 4, 'rpe updated');
    assert.equal(data.subjective_notes, realNote, 'existing note preserved byte-for-byte (the AC-153 regression)');
    assert.equal(data.feel_legs, 'normal', 'feel_legs preserved');
    assert.equal(data.injury_flag, 'nothing', 'injury_flag preserved');
  } finally { await d.from('activities').delete().eq('user_id', UID); }
});

test('AC-153 TEST 1 (live) — empty feedback call mutates no column', { skip }, async () => {
  const d = await db();
  await d.from('activities').delete().eq('user_id', UID);
  try {
    const realNote = 'kept it easy, felt fine';
    const ins = await d.from('activities')
      .insert({ user_id: UID, name: 'Test Run', type: 'Run', date: '2026-06-21T08:00:00Z', is_deleted: false, rpe: 3, subjective_notes: realNote })
      .select('id').single();
    assert.equal(ins.error, null, ins.error?.message);
    const id = ins.data.id;
    const before = await d.from('activities').select('rpe,feel_legs,injury_flag,subjective_notes,subjective_captured_at').eq('id', id).single();
    const res = await logSessionFeedback(client(), { activity_id: id, commit: true }, { userId: UID });
    assert.notEqual(res.committed, true);
    assert.equal(res.refused, true);
    const after = await d.from('activities').select('rpe,feel_legs,injury_flag,subjective_notes,subjective_captured_at').eq('id', id).single();
    assert.deepEqual(after.data, before.data, 'no column mutated by an empty feedback call');
  } finally { await d.from('activities').delete().eq('user_id', UID); }
});

test('IDEMPOTENCY: write_coaching_memory twice -> one row', { skip }, async () => {
  const d = await db();
  await d.from('coaching_memory').delete().eq('user_id', UID);
  try {
    const payload = { source: 'mcp-test', content: 'first', date: '2026-06-21', type: 'note', category: 'note', commit: true };
    await writeCoachingMemory(client(), payload, { userId: UID });
    await writeCoachingMemory(client(), { ...payload, content: 'second' }, { userId: UID });
    const { data } = await d.from('coaching_memory').select('content').eq('user_id', UID);
    assert.equal(data.length, 1, 'unique (user_id,date,source) -> single row');
    assert.equal(data[0].content, 'second', 'upsert merged to latest');
  } finally { await d.from('coaching_memory').delete().eq('user_id', UID); }
});

test('NO-SILENT-FILL + READBACK: update_athlete_profile only on commit, allowed field only', { skip }, async () => {
  const d = await db();
  await d.from('athlete_settings').delete().eq('user_id', UID);
  try {
    await d.from('athlete_settings').insert({ user_id: UID, goal_type: 'finish' });
    // propose (no commit) must NOT change the row
    await updateAthleteProfile(client(), { goal_type: 'compete' }, { userId: UID });
    let { data } = await d.from('athlete_settings').select('goal_type,weight_kg').eq('user_id', UID).single();
    assert.equal(data.goal_type, 'finish', 'no write without commit');
    // commit writes the allowed field
    const done = await updateAthleteProfile(client(), { goal_type: 'compete', weight_kg: 80, commit: true }, { userId: UID });
    assert.equal(done.committed, true);
    ({ data } = await d.from('athlete_settings').select('goal_type,weight_kg').eq('user_id', UID).single());
    assert.equal(data.goal_type, 'compete');
    assert.equal(Number(data.weight_kg), 80);
  } finally {
    await d.from('athlete_settings').delete().eq('user_id', UID);
    await d.from('coaching_memory').delete().eq('user_id', UID);
  }
});

test('PROPOSE-NOT-MUTATE: propose_schedule_change creates pending row, leaves scheduled_sessions', { skip }, async () => {
  const d = await db();
  await d.from('schedule_changes').delete().eq('user_id', UID);
  try {
    const before = await d.from('scheduled_sessions').select('id', { count: 'exact', head: true }).eq('user_id', UID);
    const done = await proposeScheduleChange(client(), { change_type: 'reschedule', title: 'Move session', new_date: '2026-06-28', reasoning: 'travel', commit: true }, { userId: UID });
    assert.equal(done.committed, true);
    const { data: changes } = await d.from('schedule_changes').select('status,proposed_by').eq('user_id', UID);
    assert.equal(changes.length, 1);
    assert.equal(changes[0].status, 'pending');
    const after = await d.from('scheduled_sessions').select('id', { count: 'exact', head: true }).eq('user_id', UID);
    assert.equal(after.count, before.count, 'scheduled_sessions untouched');
  } finally { await d.from('schedule_changes').delete().eq('user_id', UID); }
});
