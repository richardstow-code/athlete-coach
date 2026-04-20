/**
 * API tests: Vercel route-planner route
 *
 * Tier: @minor
 *
 * Tests against the live Vercel deployment.
 * Set VERCEL_DEPLOYMENT_URL in tests/.env.test to override.
 *
 * Routing tests call GraphHopper with real coordinates in the Salzburg region.
 * They are skipped unless GRAPHHOPPER_API_KEY is set in the test environment.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { config } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: join(__dirname, '../.env.test') })

const BASE = (process.env.VERCEL_DEPLOYMENT_URL ?? 'https://athlete-coach-alpha.vercel.app').replace(/\/$/, '')
const PLANNER_URL = `${BASE}/api/route-planner`

// ── Test 1: GET → 405 ────────────────────────────────────────────────────────

test('@minor route-planner: GET returns 405', async () => {
  const res = await fetch(PLANNER_URL, { method: 'GET' })
  assert.equal(res.status, 405, `Expected 405, got ${res.status}`)
  const body = await res.json()
  assert.ok(body.error, 'Response should include an error field')
})

// ── Test 2: POST with missing action → 400 ───────────────────────────────────

test('@minor route-planner: POST with unknown action returns 400', async () => {
  const res = await fetch(PLANNER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'unknown' }),
  })
  assert.equal(res.status, 400, `Expected 400, got ${res.status}`)
})

// ── Test 3: POST route with <2 points → 400 ──────────────────────────────────

test('@minor route-planner: POST route with only 1 point returns 400', async () => {
  const res = await fetch(PLANNER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'route', points: [[47.8, 13.0]] }),
  })
  assert.equal(res.status, 400, `Expected 400 for <2 points, got ${res.status}`)
})

// ── Test 4: POST geocode with missing lat/lng → 400 ──────────────────────────

test('@minor route-planner: POST geocode without lat/lng returns 400', async () => {
  const res = await fetch(PLANNER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'geocode' }),
  })
  assert.equal(res.status, 400, `Expected 400, got ${res.status}`)
})

// ── Test 5: POST route with valid coordinates → 200 with polyline ─────────────
// Skipped when GRAPHHOPPER_API_KEY is not available in test env

test('@minor route-planner: POST route returns polyline, distance_m, elevation_gain_m', async (t) => {
  // We can't easily check if GRAPHHOPPER_API_KEY is set in the Vercel env from here,
  // but we can check if the key is present in the local test environment.
  // If not present locally, we still run the test against the deployed endpoint
  // (which has the key) and assert the response shape.
  const res = await fetch(PLANNER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'route',
      points: [[47.8, 13.0], [47.7, 13.1]],
      vehicle: 'run',
      elevation: true,
    }),
  })

  if (res.status === 500) {
    const body = await res.json()
    if (body.error?.includes('GRAPHHOPPER_API_KEY not configured')) {
      t.skip('GRAPHHOPPER_API_KEY not configured on deployment — add env var to Vercel project')
      return
    }
  }

  assert.equal(res.status, 200, `Expected 200, got ${res.status} — ${await res.clone().text()}`)
  const data = await res.json()

  assert.ok(Array.isArray(data.polyline), 'polyline must be an array')
  assert.ok(data.polyline.length >= 2, 'polyline must have at least 2 points')
  assert.ok(typeof data.distance_m === 'number', 'distance_m must be a number')
  assert.ok(typeof data.elevation_gain_m === 'number', 'elevation_gain_m must be a number')
  assert.ok(data.distance_m > 0, 'distance_m should be > 0 for two distinct points')
})

// ── Test 6: POST geocode with valid coordinates → 200 ─────────────────────────

test('@minor route-planner: POST geocode returns place fields', async (t) => {
  const res = await fetch(PLANNER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'geocode', lat: 47.8, lng: 13.0 }),
  })

  if (res.status === 500) {
    const body = await res.json()
    if (body.error?.includes('GRAPHHOPPER_API_KEY not configured')) {
      t.skip('GRAPHHOPPER_API_KEY not configured on deployment')
      return
    }
  }

  assert.equal(res.status, 200, `Expected 200, got ${res.status}`)
  const data = await res.json()

  // Fields may be null if GH returns no hit, but all keys must be present
  assert.ok('name' in data, 'Response must have name field')
  assert.ok('city' in data, 'Response must have city field')
  assert.ok('place_name' in data, 'Response must have place_name field')
  assert.ok('nearest_feature' in data, 'Response must have nearest_feature field')
  assert.ok('region' in data, 'Response must have region field')
})

// ── Test 7: CORS header present ──────────────────────────────────────────────

test('@minor route-planner: CORS header present', async () => {
  const res = await fetch(PLANNER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'geocode', lat: 47.8, lng: 13.0 }),
  })
  const cors = res.headers.get('access-control-allow-origin')
  assert.ok(cors, 'Access-Control-Allow-Origin header must be present')
})
