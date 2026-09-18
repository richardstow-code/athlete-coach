/**
 * AC-157 regression: persistCoachTake must NOT destroy activities.raw_data.
 *
 * The bug: persistCoachTake() PATCHed `raw_data: { coach_take_audit: audit }`.
 * PostgREST REPLACES a jsonb column on PATCH — it does not merge — so every
 * Coach's-Take generation wiped splits_metric, laps and pace_variation off the
 * activity. Activity 418 (1 Aug 2026) is the confirmed casualty in production:
 * its raw_data is now `{coach_take_audit}` alone, and enrich-activity's
 * recompute_splits path reads raw_data.splits_metric, so that row can no longer
 * be recomputed.
 *
 * The canonical activities.splits_metric COLUMN survived, which is why nothing
 * looked broken — this is precisely the silent-corruption class the AC-157
 * brief's "recorded values are immutable" rule exists to prevent.
 *
 * Tier @major. Pure-logic: asserts the merge helper preserves every pre-existing
 * key. The live PATCH is architect-verified against production.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mergeRawData } from '../../api/claude-proxy.js';

// The exact raw_data shape the LIVE Vercel ingest writes
// (api/strava-webhook.js buildActivityRow).
const INGEST_RAW_DATA = {
  splits_metric: [
    { split: 1, distance: 1002, moving_time: 319, average_speed: 3.14 },
    { split: 2, distance: 1000, moving_time: 311, average_speed: 3.21 },
  ],
  laps: [{ lap_index: 1, distance: 2002, moving_time: 630 }],
  pace_variation: 27,
  workout_type: 'tempo',
};

const AUDIT = { model: 'claude-haiku-4-5-20251001', missing_metrics: ['hrv'], generated_at: '2026-08-06T09:00:00Z' };

test('merge preserves every field the ingest path wrote', () => {
  const out = mergeRawData(INGEST_RAW_DATA, { coach_take_audit: AUDIT });

  assert.deepEqual(out.splits_metric, INGEST_RAW_DATA.splits_metric, 'splits_metric survives');
  assert.deepEqual(out.laps, INGEST_RAW_DATA.laps, 'laps survives');
  assert.equal(out.pace_variation, 27, 'pace_variation survives');
  assert.equal(out.workout_type, 'tempo', 'workout_type survives');
  assert.deepEqual(out.coach_take_audit, AUDIT, 'the audit is written');
});

test('the exact activity-418 corruption no longer reproduces', () => {
  const out = mergeRawData(INGEST_RAW_DATA, { coach_take_audit: AUDIT });
  const keys = Object.keys(out).sort();
  assert.deepEqual(
    keys,
    ['coach_take_audit', 'laps', 'pace_variation', 'splits_metric', 'workout_type'],
    'raw_data must NOT collapse to [coach_take_audit] alone',
  );
  assert.notDeepEqual(keys, ['coach_take_audit']);
});

test('repeated takes are idempotent and never erode raw_data', () => {
  let out = INGEST_RAW_DATA;
  for (let i = 0; i < 5; i++) {
    out = mergeRawData(out, { coach_take_audit: { ...AUDIT, run: i } });
  }
  assert.equal(out.splits_metric.length, 2, 'splits still present after 5 regenerations');
  assert.equal(out.laps.length, 1);
  assert.equal(out.coach_take_audit.run, 4, 'latest audit wins');
});

test('a later audit overwrites only the audit key', () => {
  const first = mergeRawData(INGEST_RAW_DATA, { coach_take_audit: AUDIT });
  const second = mergeRawData(first, { coach_take_audit: { model: 'claude-sonnet-5' } });
  assert.equal(second.coach_take_audit.model, 'claude-sonnet-5');
  assert.deepEqual(second.splits_metric, INGEST_RAW_DATA.splits_metric);
});

test('coexists with the freshness fields regenerate-coaching-artifact writes', () => {
  const withFreshness = mergeRawData(INGEST_RAW_DATA, {
    coach_take_audit: AUDIT,
    coach_take_regen_status: 'fresh',
    coach_take_fingerprint: 'abc123',
  });
  const afterNewTake = mergeRawData(withFreshness, { coach_take_audit: { model: 'x' } });
  assert.equal(afterNewTake.coach_take_regen_status, 'fresh', 'freshness bookkeeping survives');
  assert.equal(afterNewTake.coach_take_fingerprint, 'abc123');
  assert.deepEqual(afterNewTake.laps, INGEST_RAW_DATA.laps);
});

test('null / absent / malformed raw_data still records the audit', () => {
  assert.deepEqual(mergeRawData(null, { coach_take_audit: AUDIT }), { coach_take_audit: AUDIT });
  assert.deepEqual(mergeRawData(undefined, { coach_take_audit: AUDIT }), { coach_take_audit: AUDIT });
  // An array is not a valid raw_data object — treat as empty, don't spread indices.
  assert.deepEqual(mergeRawData([1, 2], { coach_take_audit: AUDIT }), { coach_take_audit: AUDIT });
  assert.deepEqual(mergeRawData('nonsense', { coach_take_audit: AUDIT }), { coach_take_audit: AUDIT });
});

test('recorded observed fields are never touched by this path', () => {
  // persistCoachTake writes ONLY raw_data. If a future edit adds pace_per_km,
  // avg_hr, distance_km or duration_min to that PATCH body, this fails.
  const src = fs.readFileSync(new URL('../../api/claude-proxy.js', import.meta.url), 'utf8');
  const start = src.indexOf('export async function persistCoachTake');
  const end = src.indexOf('export function mergeRawData');
  assert.ok(start > -1 && end > start, 'persistCoachTake and mergeRawData both present');
  const fn = src.slice(start, end);
  for (const immutable of ['pace_per_km', 'avg_hr', 'max_hr', 'distance_km', 'duration_min']) {
    assert.ok(!fn.includes(immutable), `persistCoachTake must not write ${immutable}`);
  }
});
