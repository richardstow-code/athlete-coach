/**
 * AC-157 T4 — CAPTURE at ingest, on the LIVE path.
 *
 * api/strava-webhook.js (Vercel) is the live Strava ingest. Asserts:
 *   - started_at is the true start INSTANT, correct for Europe/Vienna
 *   - activities.date is UNCHANGED (still the local date string, midnight UTC)
 *   - timezone is stored as IANA, never as Strava's "(GMT+01:00) …" display form
 *   - coordinates and device temperature are captured
 *   - a bad temperature is DROPPED rather than written, because
 *     activities_temp_c_check would otherwise fail the whole upsert and lose
 *     the activity
 *
 * The anchor fixture is activity 414 (29 Jul 2026), which started 14:12 Vienna
 * in ~31C during Austria's record July heatwave — the session the app misread
 * as mediocre, setting the athlete's zones ~8s/km slow.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  parseStravaTimezone,
  deriveStartedAt,
  deriveDeviceTemp,
  deriveStartLatLng,
} from '../../api/strava-webhook.js';

// 14:12 Vienna on 29 Jul 2026 = 12:12 UTC (CEST, UTC+2).
const ANCHOR = {
  id: 19513241126,
  name: 'Afternoon Run',
  type: 'Run',
  sport_type: 'Run',
  start_date: '2026-07-29T12:12:00Z',
  start_date_local: '2026-07-29T14:12:00Z',
  timezone: '(GMT+01:00) Europe/Vienna',
  start_latlng: [47.6835, 13.0935],
  average_temp: 31,
  average_speed: 3.984,
  distance: 14000,
  moving_time: 3515,
  splits_metric: [],
  laps: [],
};

// ── timezone parsing ─────────────────────────────────────────────────────────

test('parses the IANA zone out of Strava\'s display string', () => {
  assert.equal(parseStravaTimezone('(GMT+01:00) Europe/Vienna'), 'Europe/Vienna');
  assert.equal(parseStravaTimezone('(GMT-05:00) America/New_York'), 'America/New_York');
  assert.equal(parseStravaTimezone('(GMT+00:00) Europe/London'), 'Europe/London');
});

test('accepts a bare IANA zone', () => {
  assert.equal(parseStravaTimezone('Europe/Vienna'), 'Europe/Vienna');
});

test('never stores the GMT display form or other junk', () => {
  assert.equal(parseStravaTimezone('(GMT+01:00)'), null);
  assert.equal(parseStravaTimezone('GMT+01:00'), null);
  assert.equal(parseStravaTimezone(''), null);
  assert.equal(parseStravaTimezone(null), null);
  assert.equal(parseStravaTimezone(undefined), null);
  assert.equal(parseStravaTimezone(12345), null);
});

// ── started_at ───────────────────────────────────────────────────────────────

test('started_at is the true UTC instant of a 14:12 Vienna start', () => {
  assert.equal(deriveStartedAt(ANCHOR), '2026-07-29T12:12:00.000Z');
});

test('started_at renders back to 14:12 in Europe/Vienna', () => {
  const local = new Date(deriveStartedAt(ANCHOR)).toLocaleTimeString('en-GB', {
    timeZone: 'Europe/Vienna', hour: '2-digit', minute: '2-digit',
  });
  assert.equal(local, '14:12');
});

test('falls back to start_date_local + IANA zone when start_date is absent', () => {
  const { start_date, ...noUtc } = ANCHOR;
  assert.equal(deriveStartedAt(noUtc), '2026-07-29T12:12:00.000Z');
});

test('the fallback respects DST — January is CET (+1), July is CEST (+2)', () => {
  const winter = {
    start_date_local: '2026-01-15T14:12:00Z',
    timezone: '(GMT+01:00) Europe/Vienna',
  };
  assert.equal(deriveStartedAt(winter), '2026-01-15T13:12:00.000Z');
});

test('started_at is null — never a guess — when there is nothing to derive it from', () => {
  assert.equal(deriveStartedAt({}), null);
  assert.equal(deriveStartedAt({ start_date_local: '2026-07-29T14:12:00Z' }), null); // no zone
  assert.equal(deriveStartedAt({ start_date: 'not-a-date' }), null);
});

// ── activities.date is NOT repurposed ────────────────────────────────────────

test('activities.date logic is untouched by AC-157', () => {
  const src = fs.readFileSync(new URL('../../api/strava-webhook.js', import.meta.url), 'utf8');
  const row = src.slice(src.indexOf('function buildActivityRow'), src.indexOf('// ── Supabase upsert'));

  // The date expression must still be the local-date slice it always was.
  assert.ok(
    /const date = activity\.start_date_local\s*\?\s*activity\.start_date_local\.slice\(0, 10\)/.test(row),
    'date is still derived from start_date_local.slice(0,10)',
  );
  // started_at must be a SEPARATE field, not an overwrite of date.
  assert.ok(/started_at: deriveStartedAt\(activity\)/.test(row), 'started_at is additive');
  assert.ok(!/date: deriveStartedAt/.test(row), 'date must NOT be rewritten to the instant');
});

test('the ingest path writes no observed field it did not write before (1E)', () => {
  const src = fs.readFileSync(new URL('../../api/strava-webhook.js', import.meta.url), 'utf8');
  const row = src.slice(src.indexOf('function buildActivityRow'), src.indexOf('// ── Supabase upsert'));
  // These are recorded observations. AC-157 must not add or alter them here.
  for (const f of ['heat_adjusted_pace', 'heat_adjustment_pct', 'heat_adjustment_basis']) {
    assert.ok(!row.includes(f), `ingest must not write ${f} — that is enrichment's job`);
  }
});

// ── coordinates ──────────────────────────────────────────────────────────────

test('captures start coordinates', () => {
  assert.deepEqual(deriveStartLatLng(ANCHOR), { start_lat: 47.6835, start_lng: 13.0935 });
});

test('drops absent, malformed or out-of-range coordinates', () => {
  const none = { start_lat: null, start_lng: null };
  assert.deepEqual(deriveStartLatLng({}), none);
  assert.deepEqual(deriveStartLatLng({ start_latlng: [] }), none);
  assert.deepEqual(deriveStartLatLng({ start_latlng: [47.6] }), none);
  assert.deepEqual(deriveStartLatLng({ start_latlng: ['a', 'b'] }), none);
  assert.deepEqual(deriveStartLatLng({ start_latlng: [91, 0] }), none);
  assert.deepEqual(deriveStartLatLng({ start_latlng: [0, 181] }), none);
});

// ── temperature ──────────────────────────────────────────────────────────────

test('captures device temperature and tags the source', () => {
  assert.deepEqual(deriveDeviceTemp(ANCHOR), { temp_c: 31, weather_source: 'strava_device' });
});

test('weather_source is one of the values the CHECK constraint allows', () => {
  const allowed = ['strava_device', 'openweather', 'estimated', null];
  assert.ok(allowed.includes(deriveDeviceTemp(ANCHOR).weather_source));
  assert.ok(allowed.includes(deriveDeviceTemp({}).weather_source));
});

test('no temperature → both fields null, never a default', () => {
  assert.deepEqual(deriveDeviceTemp({}), { temp_c: null, weather_source: null });
  assert.deepEqual(deriveDeviceTemp({ average_temp: null }), { temp_c: null, weather_source: null });
});

test('an out-of-range reading is DROPPED, not written — the CHECK would lose the activity', () => {
  // activities_temp_c_check: temp_c IS NULL OR (temp_c >= -60 AND temp_c <= 60)
  for (const bad of [-61, 61, 999, -999, NaN, Infinity]) {
    assert.deepEqual(
      deriveDeviceTemp({ average_temp: bad }),
      { temp_c: null, weather_source: null },
      `${bad} must be dropped`,
    );
  }
  // Boundaries are inclusive and DO pass.
  assert.equal(deriveDeviceTemp({ average_temp: -60 }).temp_c, -60);
  assert.equal(deriveDeviceTemp({ average_temp: 60 }).temp_c, 60);
});

test('0C is captured, not treated as falsy-absent', () => {
  assert.deepEqual(deriveDeviceTemp({ average_temp: 0 }), { temp_c: 0, weather_source: 'strava_device' });
});
