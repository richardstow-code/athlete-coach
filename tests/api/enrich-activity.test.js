/**
 * API tests: enrich-activity pipeline
 *
 * Tier: @minor — runs in CI at MINOR tier and above via `npm run test:api`.
 *
 * Requires tests/.env.test:
 *   TEST_SUPABASE_URL
 *   TEST_SUPABASE_SERVICE_KEY
 *
 * Tests 2 and 3 are skipped unless TEST_SUPABASE_FUNCTIONS_URL is also set,
 * which requires the edge functions to be deployed on the test project:
 *   TEST_SUPABASE_FUNCTIONS_URL=https://nvoqqhaybhswdqcjyaws.supabase.co/functions/v1
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: join(__dirname, '../.env.test') })

// ── Safety guard ─────────────────────────────────────────────────────────────
const PROD_PROJECT_ID = 'yjuhzmknabedjklsgbje'
const supabaseUrl = process.env.TEST_SUPABASE_URL || ''
if (supabaseUrl.includes(PROD_PROJECT_ID)) {
  console.error('FATAL: TEST_SUPABASE_URL points to the production project. Aborting.')
  process.exit(1)
}
if (!supabaseUrl) {
  console.error('FATAL: TEST_SUPABASE_URL not set. Aborting.')
  process.exit(1)
}

const supabase = createClient(
  supabaseUrl,
  process.env.TEST_SUPABASE_SERVICE_KEY || '',
  { auth: { autoRefreshToken: false, persistSession: false } }
)

// Edge functions URL — defaults to derived URL but must be set explicitly for tests 2 & 3
const FUNCTIONS_URL = process.env.TEST_SUPABASE_FUNCTIONS_URL

// Test personas
const ANNA_USER_ID = '00000000-0000-0001-0000-000000000004'  // elite_taper — many run activities
const DAVE_USER_ID = '00000000-0000-0001-0000-000000000005'  // struggling — used as poison-token target

// ── Test 1: Data integrity ────────────────────────────────────────────────────
// Every enriched run/ride activity in the test DB must have a corresponding
// activity_streams row. Catches seed gaps and pipeline regressions.
// Does not require edge functions — pure DB read.

test('@minor enrichment integrity: every complete run/ride activity has an activity_streams row', async () => {
  const { data: complete, error: e1 } = await supabase
    .from('activities')
    .select('id, name, type')
    .eq('enrichment_status', 'complete')
    .in('type', ['run', 'ride'])
    .not('strava_id', 'is', null)

  assert.ifError(e1)
  assert.ok(
    complete.length > 0,
    'No complete run/ride activities found in test DB — run `npm run seed:test` first'
  )

  const activityIds = complete.map(a => a.id)

  const { data: streams, error: e2 } = await supabase
    .from('activity_streams')
    .select('activity_id')
    .in('activity_id', activityIds)

  assert.ifError(e2)

  const streamIds = new Set(streams.map(s => s.activity_id))
  const missing = complete.filter(a => !streamIds.has(a.id))

  assert.equal(
    missing.length,
    0,
    `${missing.length} enriched activities missing stream rows:\n` +
    missing.slice(0, 5).map(a => `  - [${a.id}] ${a.name} (${a.type})`).join('\n')
  )
})

// ── Test 2: Direct invocation ─────────────────────────────────────────────────
// Calling the edge function with a correctly-formed INSERT envelope must change
// enrichment_status away from 'pending'. The test project's strava_tokens table
// will typically lack a real token, so the function may set status='failed' or
// 'complete' depending on the test environment. The key assertion is that it
// does NOT stay 'pending'.

test('@minor direct invocation: edge function changes enrichment_status from pending', async (t) => {
  if (!FUNCTIONS_URL) {
    t.skip('TEST_SUPABASE_FUNCTIONS_URL not set — deploy edge functions to test project to enable')
    return
  }

  const TEST_STRAVA_ID = 99900001

  // Clean up any remnant from a previous failed test run
  const { data: existing } = await supabase
    .from('activities')
    .select('id')
    .eq('strava_id', TEST_STRAVA_ID)
    .eq('user_id', ANNA_USER_ID)
    .maybeSingle()
  if (existing) {
    await supabase.from('activity_streams').delete().eq('activity_id', existing.id)
    await supabase.from('activities').delete().eq('id', existing.id)
  }

  // Insert a test activity with status='pending'
  const { data: inserted, error: insertErr } = await supabase
    .from('activities')
    .insert({
      user_id: ANNA_USER_ID,
      strava_id: TEST_STRAVA_ID,
      date: new Date().toISOString(),
      name: 'CI Test Run — Direct Invocation',
      type: 'run',
      distance_km: 8,
      duration_min: 45,
      enrichment_status: 'pending',
      source: 'strava',
    })
    .select('id')
    .single()

  assert.ifError(insertErr)

  // Build the webhook envelope the edge function expects
  const payload = {
    type: 'INSERT',
    table: 'activities',
    record: {
      id: inserted.id,
      user_id: ANNA_USER_ID,
      strava_id: TEST_STRAVA_ID,
      type: 'run',
      enrichment_status: 'pending',
    },
  }

  const res = await fetch(`${FUNCTIONS_URL}/enrich-activity`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.TEST_SUPABASE_SERVICE_KEY}`,
    },
    body: JSON.stringify(payload),
  })

  assert.ok(
    res.status < 500,
    `Edge function returned server error ${res.status} — check function logs`
  )

  const { data: updated } = await supabase
    .from('activities')
    .select('enrichment_status')
    .eq('id', inserted.id)
    .single()

  assert.notEqual(
    updated?.enrichment_status,
    'pending',
    `enrichment_status must not remain 'pending' after direct invocation — ` +
    `check that the trigger payload envelope is correct: {type:'INSERT', table:'activities', record:{...}}`
  )

  // Cleanup
  await supabase.from('activity_streams').delete().eq('activity_id', inserted.id)
  await supabase.from('activities').delete().eq('id', inserted.id)
})

// ── Test 3: Graceful failure on bad token ─────────────────────────────────────
// When the user's strava_tokens row has an invalid access token, the edge
// function must set enrichment_status='failed' and must NOT write a stream row.
// Verifies the pipeline fails safely without partial data.

test('@minor graceful failure: bad Strava token → status=failed, no stream row written', async (t) => {
  if (!FUNCTIONS_URL) {
    t.skip('TEST_SUPABASE_FUNCTIONS_URL not set')
    return
  }

  const TEST_STRAVA_ID = 99900002

  // Clean up remnants
  const { data: existing } = await supabase
    .from('activities')
    .select('id')
    .eq('strava_id', TEST_STRAVA_ID)
    .eq('user_id', DAVE_USER_ID)
    .maybeSingle()
  if (existing) {
    await supabase.from('activity_streams').delete().eq('activity_id', existing.id)
    await supabase.from('activities').delete().eq('id', existing.id)
  }

  // Upsert a deliberately invalid Strava token for the test user
  const { error: tokenErr } = await supabase
    .from('strava_tokens')
    .upsert({
      user_id: DAVE_USER_ID,
      access_token: 'bad_access_token_ci_test',
      refresh_token: 'bad_refresh_token_ci_test',
      expires_at: Math.floor(Date.now() / 1000) + 3600,  // not expired — forces real API call
      athlete_id: 99999998,
    }, { onConflict: 'user_id' })

  assert.ifError(tokenErr)

  const { data: inserted, error: insertErr } = await supabase
    .from('activities')
    .insert({
      user_id: DAVE_USER_ID,
      strava_id: TEST_STRAVA_ID,
      date: new Date().toISOString(),
      name: 'CI Test Run — Bad Token',
      type: 'run',
      distance_km: 5,
      duration_min: 30,
      enrichment_status: 'pending',
      source: 'strava',
    })
    .select('id')
    .single()

  assert.ifError(insertErr)

  const payload = {
    type: 'INSERT',
    table: 'activities',
    record: {
      id: inserted.id,
      user_id: DAVE_USER_ID,
      strava_id: TEST_STRAVA_ID,
      type: 'run',
      enrichment_status: 'pending',
    },
  }

  await fetch(`${FUNCTIONS_URL}/enrich-activity`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.TEST_SUPABASE_SERVICE_KEY}`,
    },
    body: JSON.stringify(payload),
  })

  const { data: updated } = await supabase
    .from('activities')
    .select('enrichment_status')
    .eq('id', inserted.id)
    .single()

  assert.equal(
    updated?.enrichment_status,
    'failed',
    `Bad Strava token must set enrichment_status='failed', got '${updated?.enrichment_status}'`
  )

  const { data: streams } = await supabase
    .from('activity_streams')
    .select('activity_id')
    .eq('activity_id', inserted.id)

  assert.equal(
    streams.length,
    0,
    'No activity_streams row should be written when enrichment fails due to a bad token'
  )

  // Cleanup
  await supabase.from('activities').delete().eq('id', inserted.id)
  await supabase.from('strava_tokens').delete().eq('user_id', DAVE_USER_ID)
})

// ── Test 4: Trigger fires on INSERT only ──────────────────────────────────────
// Verifies that a plain UPDATE to an activity does not reset enrichment_status.
// Guards against trigger misconfiguration (AFTER INSERT OR UPDATE) which would
// re-enrich on every Strava sync and overwrite user-facing data.

test('@minor DB trigger: UPDATE to activity does not reset enrichment_status', async () => {
  const { data: activity, error } = await supabase
    .from('activities')
    .select('id, name, enrichment_status')
    .eq('enrichment_status', 'complete')
    .in('type', ['run', 'ride'])
    .limit(1)
    .single()

  assert.ifError(error)
  assert.ok(activity, 'No complete run/ride activity in test DB — run `npm run seed:test` first')

  // Simulate the strava-webhook.js UPDATE path: only non-enrichment fields change
  const { error: updateErr } = await supabase
    .from('activities')
    .update({ name: `${activity.name} (ci-test-update)` })
    .eq('id', activity.id)

  assert.ifError(updateErr)

  const { data: after } = await supabase
    .from('activities')
    .select('enrichment_status')
    .eq('id', activity.id)
    .single()

  assert.equal(
    after.enrichment_status,
    'complete',
    `UPDATE must not alter enrichment_status — got '${after.enrichment_status}'. ` +
    `Verify trigger_enrich_activity() fires on AFTER INSERT only, not INSERT OR UPDATE.`
  )

  // Restore original name
  await supabase.from('activities').update({ name: activity.name }).eq('id', activity.id)
})
