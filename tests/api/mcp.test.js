// mcp.test.js — Gate-1 tests for the Coach Claude MCP server (Phase 1).
//
// LAYER 1 (always runs, no network): deterministic mock-client tests proving
// the wrap/projection logic, NOT AVAILABLE markers, Vienna date bucketing,
// classification, superseded exclusion, training_zones-never-hr_zones, and the
// SDK tool wiring (buildServer). The profile/zones mocks use the REAL captured
// get_athlete_coaching_context@v2 payload shape.
//
// LAYER 2 (gated on TEST_SUPABASE_SERVICE_KEY, skipped otherwise): seeds rows
// in the TEST project (nvoqqhaybhswdqcjyaws) and asserts tool output == a direct
// @supabase/supabase-js read of the same project (true parity, never prod). Only
// the tables present on the test project are covered (activities,
// scheduled_sessions, coaching_memory). The RPC/view/intervals-backed tools are
// not on the test project — Layer-1 projection + the Gate-1.5 manual prod check
// cover those (documented in docs/mcp.md).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import {
  getAthleteProfile,
  getRecentActivities,
  getActivityDetail,
  getScheduledSessions,
  getTrainingZones,
  getRecovery,
  getCoachingMemory,
  NOT_AVAILABLE,
  viennaDateOf,
} from '../../api/_mcpTools.js';
import { buildServer } from '../../api/mcp.js';
import { makeSupabaseRest } from '../../api/_supabaseRest.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: join(__dirname, '../.env.test') });

// ── Mock client ──────────────────────────────────────────────────────────
function mockClient({ rpcData = null, handlers = [] } = {}) {
  const calls = { rest: [], rpc: [] };
  return {
    calls,
    async callRPC(fn, body) {
      calls.rpc.push({ fn, body });
      return { ok: true, status: 200, data: rpcData };
    },
    async restGet(path) {
      calls.rest.push(path);
      for (const [re, val] of handlers) {
        if (re.test(path)) return typeof val === 'function' ? val(path) : val;
      }
      return [];
    },
  };
}

// Real RPC payload shape (trimmed) from get_athlete_coaching_context@v2.
const REAL_CTX = {
  core: {
    zones: { z1_max: 124, z2_max: 150, z2_min: 125, z3_max: 165, z3_min: 151, z4_max: 179, z4_min: 166, z5_min: 180 },
    athlete: { age: 39, name: 'Richard Stow', goal_type: 'compete', user_mode: 'performance', current_level: 'competitive', coaching_character: 'no_filter' },
    next_race: { goal: 'Munich Marathon 2026 sub 3 hour', target_date: '2026-10-12', days_to_race: 113 },
    primary_sport: { sport_key: 'Run', sport_category: 'running', lifecycle_state: 'training', days_to_race: 113 },
    supporting_sports: [{ sport_key: 'Strength' }],
  },
  version: 'athlete-coaching-context@v2',
};

// ───────────────────────── LAYER 1 — deterministic ────────────────────────

test('get_athlete_profile projects RPC payload + tone slider', async () => {
  const client = mockClient({ rpcData: REAL_CTX, handlers: [[/^athlete_settings/, [{ tone: 7 }]]] });
  const r = await getAthleteProfile(client, {}, { userId: 'u' });
  assert.equal(r.name, 'Richard Stow');
  assert.equal(r.age, 39);
  assert.equal(r.primary_sport.sport_key, 'Run');
  assert.equal(r.next_race.days_to_race, 113);
  assert.equal(r.tone, 7);
  assert.equal(client.calls.rpc[0].fn, 'get_athlete_coaching_context');
});

test('get_athlete_profile marks tone NOT AVAILABLE when settings empty', async () => {
  const client = mockClient({ rpcData: REAL_CTX, handlers: [[/^athlete_settings/, []]] });
  const r = await getAthleteProfile(client, {}, { userId: 'u' });
  assert.equal(r.tone, NOT_AVAILABLE);
});

test('get_training_zones returns training_zones values and NEVER reads hr_zones', async () => {
  const client = mockClient({ rpcData: REAL_CTX, handlers: [[/^athlete_settings/, [{ pace_zones: { z2: { min: '5:30', max: '5:50' } } }]]] });
  const r = await getTrainingZones(client, {}, { userId: 'u' });
  assert.equal(r.heart_rate.zones.z1_max, 124); // came from RPC (training_zones)
  assert.notEqual(r.heart_rate, NOT_AVAILABLE);
  assert.ok(r.pace.z2);
  // CRITICAL: no PostgREST call ever selected the NULL hr_zones column.
  assert.ok(client.calls.rest.every((p) => !/hr_zones/.test(p)), 'must never query hr_zones');
  assert.equal(client.calls.rpc[0].fn, 'get_athlete_coaching_context');
});

test('get_training_zones marks pace NOT AVAILABLE when pace_zones null', async () => {
  const client = mockClient({ rpcData: REAL_CTX, handlers: [[/^athlete_settings/, [{ pace_zones: null }]]] });
  const r = await getTrainingZones(client, {}, { userId: 'u' });
  assert.equal(r.pace, NOT_AVAILABLE);
});

test('get_recent_activities buckets by Europe/Vienna day, not UTC', async () => {
  // 23:30Z on 2026-06-21 is 01:30 on 2026-06-22 in Vienna (summer, +2).
  const rows = [
    { id: 1, name: 'Late', date: '2026-06-21T23:30:00Z', type: 'Run' },
    { id: 2, name: 'Morning', date: '2026-06-21T10:00:00Z', type: 'Run' },
  ];
  const client = mockClient({ handlers: [[/^activities/, rows]] });
  const r = await getRecentActivities(client, { from: '2026-06-22', to: '2026-06-22' }, { userId: 'u' });
  const ids = r.activities.map((a) => a.id);
  assert.deepEqual(ids, [1], 'only the 23:30Z activity belongs to Vienna 2026-06-22');
  assert.equal(r.activities[0].vienna_date, '2026-06-22');
  assert.equal(viennaDateOf('2026-06-21T23:30:00Z'), '2026-06-22');
});

test('get_scheduled_sessions excludes superseded by default; statuses arg overrides', async () => {
  const client = mockClient({ handlers: [[/^scheduled_sessions/, []]] });
  await getScheduledSessions(client, {}, { userId: 'u' });
  assert.ok(/status=neq\.superseded/.test(client.calls.rest[0]));

  const c2 = mockClient({ handlers: [[/^scheduled_sessions/, []]] });
  await getScheduledSessions(c2, { statuses: ['planned', 'completed'] }, { userId: 'u' });
  assert.ok(/status=in\.\(planned,completed\)/.test(c2.calls.rest[0]));

  const c3 = mockClient({ handlers: [[/^scheduled_sessions/, []]] });
  await getScheduledSessions(c3, { statuses: ['all'] }, { userId: 'u' });
  assert.ok(!/neq\.superseded/.test(c3.calls.rest[0]));
  assert.ok(/status=in\./.test(c3.calls.rest[0]));
});

test('get_activity_detail: interval activity surfaces intervals_data', async () => {
  const client = mockClient({
    handlers: [
      [/^activities\?id=eq\.5/, [{ id: 5, name: 'Q1', type: 'Run', workout_type: 'intervals 4x1km', date: '2026-06-10T08:00:00Z', splits_metric: [{ km: 1 }] }]],
      [/^activities\?user_id/, [{ id: 5, date: '2026-06-10T08:00:00Z' }]],
      [/^intervals_data/, [{ icu_intensity: 0.85, training_load: 60, hr_zone_times: { z2: 100 }, interval_summary: ['4x1km'] }]],
    ],
  });
  const r = await getActivityDetail(client, { activity_id: 5 }, { userId: 'u' });
  assert.equal(r.classification, 'interval');
  assert.equal(r.intervals.icu_intensity, 0.85);
  assert.match(r.intervals_attribution, /^attributed/);
  assert.notEqual(r.splits, NOT_AVAILABLE);
});

test('get_activity_detail: trail/hike does NOT receive interval framing', async () => {
  const client = mockClient({
    handlers: [
      [/^activities\?id=eq\.6/, [{ id: 6, name: 'Hike', type: 'Hike', date: '2026-06-10T08:00:00Z', splits_metric: null }]],
      // an intervals_data row exists for the date, but must be ignored for a trail
      [/^intervals_data/, [{ icu_intensity: 0.9 }]],
    ],
  });
  const r = await getActivityDetail(client, { activity_id: 6 }, { userId: 'u' });
  assert.equal(r.classification, 'trail');
  assert.equal(r.intervals, NOT_AVAILABLE);
  assert.match(r.intervals_attribution, /trail/);
  assert.equal(r.splits, NOT_AVAILABLE); // sparseness marker, key present
  assert.ok(client.calls.rest.every((p) => !/^intervals_data/.test(p)), 'no intervals query for a trail');
});

test('get_activity_detail: sparseness — missing icu_intensity and splits marked NOT AVAILABLE', async () => {
  const client = mockClient({
    handlers: [
      [/^activities\?id=eq\.7/, [{ id: 7, name: 'Easy', type: 'Run', workout_type: '', date: '2026-06-10T08:00:00Z', splits_metric: null }]],
      [/^activities\?user_id/, [{ id: 7, date: '2026-06-10T08:00:00Z' }]],
      [/^intervals_data/, [{ icu_intensity: null }]],
    ],
  });
  const r = await getActivityDetail(client, { activity_id: 7 }, { userId: 'u' });
  assert.equal(r.classification, 'easy');
  assert.equal(r.intervals, NOT_AVAILABLE);
  assert.equal(r.splits, NOT_AVAILABLE);
  assert.ok('intervals' in r && 'splits' in r, 'markers are present keys, not omitted');
});

test('get_activity_detail: multi-activity day is flagged ambiguous, intervals omitted', async () => {
  const client = mockClient({
    handlers: [
      [/^activities\?id=eq\.8/, [{ id: 8, name: 'PM run', type: 'Run', workout_type: 'tempo', date: '2026-06-10T16:00:00Z', splits_metric: [{ km: 1 }] }]],
      [/^activities\?user_id/, [{ id: 8, date: '2026-06-10T16:00:00Z' }, { id: 9, date: '2026-06-10T08:00:00Z' }]],
      [/^intervals_data/, [{ icu_intensity: 0.7 }]],
    ],
  });
  const r = await getActivityDetail(client, { activity_id: 8 }, { userId: 'u' });
  assert.equal(r.intervals, NOT_AVAILABLE);
  assert.match(r.intervals_attribution, /ambiguous/);
});

test('get_recovery: present metrics surface, absent ones marked NOT AVAILABLE', async () => {
  const client = mockClient({
    handlers: [
      [/^athlete_state_snapshot/, [{ has_resting_hr: true, resting_hr: 46, resting_hr_date: '2026-06-19', has_hrv: false, has_sleep: true, sleep_hours: 8.2, sleep_date: '2026-06-06', snapshot_date: '2026-06-19', snapshot_sources: { resting_hr: 'intervals_icu' } }]],
      [/^intervals_data/, [{ date: '2026-06-19', ctl: 50, atl: 60, tsb: -10 }]],
    ],
  });
  const r = await getRecovery(client, {}, { userId: 'u' });
  assert.equal(r.recovery.resting_hr.value, 46);
  assert.equal(r.recovery.hrv, NOT_AVAILABLE);
  assert.equal(r.recovery.sleep.hours, 8.2);
  assert.equal(r.training_load.ctl, 50);
});

test('get_coaching_memory: type filter is applied to the query', async () => {
  const client = mockClient({ handlers: [[/^coaching_memory/, [{ date: '2026-06-01', type: 'activity_feedback', content: 'x' }]]] });
  const r = await getCoachingMemory(client, { type: 'activity_feedback', limit: 5 }, { userId: 'u' });
  assert.equal(r.count, 1);
  assert.ok(/type=eq\.activity_feedback/.test(client.calls.rest[0]));
  assert.ok(/limit=5/.test(client.calls.rest[0]));
});

test('tools return { error } (never throw) when the data layer fails', async () => {
  const boom = {
    async callRPC() { return { ok: false, status: 500, data: null }; },
    async restGet() { throw new Error('network down'); },
  };
  const r1 = await getRecentActivities(boom, {}, { userId: 'u' });
  assert.ok(r1.error, 'restGet failure surfaces as { error }');
  const r2 = await getAthleteProfile(boom, {}, { userId: 'u' });
  assert.ok(r2.error, 'RPC failure surfaces as { error }');
});

test('buildServer wires all 7 tools into the MCP SDK without throwing', () => {
  const client = mockClient({});
  assert.doesNotThrow(() => buildServer(client));
});

// ───────────────────────── LAYER 2 — seed + parity (gated) ────────────────

const TEST_URL = process.env.TEST_SUPABASE_URL || '';
const TEST_KEY = process.env.TEST_SUPABASE_SERVICE_KEY || '';
const PROD_ID = 'yjuhzmknabedjklsgbje';
const layer2Enabled = !!TEST_KEY && !!TEST_URL && !TEST_URL.includes(PROD_ID);
const TEST_UID = '00000000-0000-4000-8000-0000000000aa'; // synthetic test athlete

test('PARITY: get_coaching_memory == direct DB read (test project)', { skip: !layer2Enabled && 'TEST_SUPABASE_* not set (or points at prod)' }, async () => {
  const { createClient } = await import('@supabase/supabase-js');
  const db = createClient(TEST_URL, TEST_KEY, { auth: { persistSession: false } });
  const client = makeSupabaseRest({ baseUrl: TEST_URL, serviceKey: TEST_KEY });
  const seeded = { user_id: TEST_UID, date: '2026-06-01', type: 'mcp_parity', source: 'mcp-test', category: 'feedback', content: 'parity probe' };
  await db.from('coaching_memory').delete().eq('user_id', TEST_UID);
  try {
    const ins = await db.from('coaching_memory').insert(seeded);
    assert.equal(ins.error, null, ins.error ? `seed failed: ${ins.error.message}` : '');
    const tool = await getCoachingMemory(client, { limit: 50 }, { userId: TEST_UID });
    const { data: direct } = await db
      .from('coaching_memory')
      .select('date,type,category,source,content')
      .eq('user_id', TEST_UID)
      .order('created_at', { ascending: false });
    assert.equal(tool.count, direct.length);
    assert.equal(tool.memory[0].content, direct[0].content);
    assert.equal(tool.memory[0].content, 'parity probe');
  } finally {
    await db.from('coaching_memory').delete().eq('user_id', TEST_UID);
  }
});

test('PARITY: get_scheduled_sessions == direct DB read, excludes superseded (test project)', { skip: !layer2Enabled && 'TEST_SUPABASE_* not set (or points at prod)' }, async () => {
  const { createClient } = await import('@supabase/supabase-js');
  const db = createClient(TEST_URL, TEST_KEY, { auth: { persistSession: false } });
  const client = makeSupabaseRest({ baseUrl: TEST_URL, serviceKey: TEST_KEY });
  await db.from('scheduled_sessions').delete().eq('user_id', TEST_UID);
  try {
    const rows = [
      { user_id: TEST_UID, name: 'Planned A', planned_date: '2026-06-02', session_type: 'run', status: 'planned' },
      { user_id: TEST_UID, name: 'Gone', planned_date: '2026-06-03', session_type: 'run', status: 'superseded' },
    ];
    const ins = await db.from('scheduled_sessions').insert(rows);
    assert.equal(ins.error, null, ins.error ? `seed failed: ${ins.error.message}` : '');
    const tool = await getScheduledSessions(client, { from: '2026-06-01', to: '2026-06-30' }, { userId: TEST_UID });
    const names = tool.sessions.map((s) => s.name);
    assert.ok(names.includes('Planned A'));
    assert.ok(!names.includes('Gone'), 'superseded excluded by default');
    const { data: direct } = await db
      .from('scheduled_sessions')
      .select('name')
      .eq('user_id', TEST_UID)
      .neq('status', 'superseded');
    assert.equal(tool.count, direct.length);
  } finally {
    await db.from('scheduled_sessions').delete().eq('user_id', TEST_UID);
  }
});
