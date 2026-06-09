/**
 * API test: enrich-activity must never read a soft-deleted activity_streams row
 * (ticket 78d16ed2 / AC-153 invariant — behavioural counterpart to the
 * source-level guard in the native repo's ac-153-soft-delete-cascade test).
 *
 * Tier: @minor. Gated on TEST_SUPABASE_FUNCTIONS_URL (the edge function must be
 * deployed to the test project), exactly like enrich-activity.test.js tests 2/3.
 *
 * Real failure mode: with a live + a soft-deleted stream row for the same
 * activity, an unfiltered `.maybeSingle()` read throws "multiple rows" and
 * enrichment silently breaks / reads the wrong row. The `.eq('is_deleted',
 * false)` filter must make the function read ONLY the live row.
 *
 * Requires tests/.env.test:
 *   TEST_SUPABASE_URL, TEST_SUPABASE_SERVICE_KEY, TEST_SUPABASE_FUNCTIONS_URL
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: join(__dirname, '../.env.test') })

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

const FUNCTIONS_URL = process.env.TEST_SUPABASE_FUNCTIONS_URL
const ANNA_USER_ID = '00000000-0000-0001-0000-000000000004' // elite_taper

// A live stream with real samples; a soft-deleted stream with junk samples.
// If enrichment ever reads the deleted row, the result would reflect the junk
// (or the maybeSingle read would error on two rows).
const LIVE_SAMPLES = Array.from({ length: 60 }, (_, i) => ({ t: i * 5, hr: 140, vel: 3.0, alt: 100 }))
const DELETED_SAMPLES = [{ t: 0, hr: 999, vel: 0, alt: 0 }]

test('@minor enrich-activity reads only the live activity_streams row (soft-delete safe)', async (t) => {
  if (!FUNCTIONS_URL) {
    t.skip('TEST_SUPABASE_FUNCTIONS_URL not set — deploy enrich-activity to the test project to enable')
    return
  }

  const TEST_STRAVA_ID = 99900003

  // Clean any remnants.
  const { data: existing } = await supabase
    .from('activities').select('id').eq('strava_id', TEST_STRAVA_ID).eq('user_id', ANNA_USER_ID).maybeSingle()
  if (existing) {
    await supabase.from('activity_streams').delete().eq('activity_id', existing.id)
    await supabase.from('activities').delete().eq('id', existing.id)
  }

  const { data: inserted, error: insertErr } = await supabase
    .from('activities')
    .insert({
      user_id: ANNA_USER_ID, strava_id: TEST_STRAVA_ID, date: new Date().toISOString(),
      name: 'CI Test Run — soft-delete stream guard', type: 'run',
      distance_km: 6, duration_min: 35, enrichment_status: 'pending', source: 'strava',
    })
    .select('id').single()
  assert.ifError(insertErr)

  // Insert the soft-deleted junk row FIRST, then the live row.
  const { error: delRowErr } = await supabase.from('activity_streams').insert({
    activity_id: inserted.id, user_id: ANNA_USER_ID, samples: DELETED_SAMPLES, is_deleted: true,
  })
  assert.ifError(delRowErr)
  const { error: liveRowErr } = await supabase.from('activity_streams').insert({
    activity_id: inserted.id, user_id: ANNA_USER_ID, samples: LIVE_SAMPLES, is_deleted: false,
  })
  assert.ifError(liveRowErr)

  // Invoke enrichment.
  const res = await fetch(`${FUNCTIONS_URL}/enrich-activity`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.TEST_SUPABASE_SERVICE_KEY}` },
    body: JSON.stringify({ type: 'INSERT', table: 'activities', record: { id: inserted.id, user_id: ANNA_USER_ID, strava_id: TEST_STRAVA_ID, type: 'run', enrichment_status: 'pending' } }),
  })

  // Must not 5xx — an unfiltered maybeSingle() over two rows would error.
  assert.ok(res.status < 500, `enrich-activity 5xx'd with a soft-deleted sibling stream row (status ${res.status}) — the is_deleted filter is missing`)

  // The live row must be untouched and still present; the deleted row stays deleted.
  const { data: liveRows } = await supabase
    .from('activity_streams').select('samples, is_deleted').eq('activity_id', inserted.id).eq('is_deleted', false)
  assert.equal(liveRows?.length, 1, 'exactly one live stream row should remain')
  assert.equal((liveRows[0].samples)?.[0]?.hr, 140, 'enrichment must operate on the live row, not the soft-deleted junk row')

  // Cleanup.
  await supabase.from('activity_streams').delete().eq('activity_id', inserted.id)
  await supabase.from('activities').delete().eq('id', inserted.id)
})
