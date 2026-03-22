/**
 * Vercel Serverless Function — Strava Webhook Handler (Stage 1)
 *
 * Stage 1 only: receive event → fetch activity → write to DB with
 * enrichment_status='pending' → return 200 immediately.
 *
 * Stage 2 (enrichment, streams, coaching feedback) is handled by
 * the Supabase edge function `enrich-activity`, triggered by a
 * Supabase database webhook on activities INSERT.
 */

const SUPABASE_URL = 'https://yjuhzmknabedjklsgbje.supabase.co'
const TZ = 'Europe/Vienna'
const ATHLETE_USER_ID = '40cfe68e-faea-491c-b410-0093572f02d6'

function viennaDate(ts) {
  return new Date(ts).toLocaleDateString('en-CA', { timeZone: TZ })
}

// ── Strava token refresh ──────────────────────────────────────────────────────

async function getStravaToken() {
  const res = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      refresh_token: process.env.STRAVA_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  })
  if (!res.ok) throw new Error(`Strava token refresh failed: ${res.status}`)
  const data = await res.json()
  return data.access_token
}

// ── Fetch full activity from Strava ──────────────────────────────────────────

async function fetchActivity(activityId, token) {
  const res = await fetch(`https://www.strava.com/api/v3/activities/${activityId}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`Strava activity fetch failed: ${res.status}`)
  return res.json()
}

// ── Minimal enrichment: pace and date ────────────────────────────────────────

function buildActivityRow(activity) {
  let pacePerKm = null
  if (activity.average_speed && activity.average_speed > 0) {
    const secPerKm = 1000 / activity.average_speed
    const mins = Math.floor(secPerKm / 60)
    const secs = Math.round(secPerKm % 60)
    pacePerKm = `${mins}:${String(secs).padStart(2, '0')}`
  }

  const date = activity.start_date_local
    ? activity.start_date_local.slice(0, 10)
    : viennaDate(activity.start_date ? new Date(activity.start_date).getTime() : Date.now())

  const splits = activity.splits_metric || []
  const paces = splits
    .filter(s => s.distance > 100 && s.moving_time > 0)
    .map(s => s.moving_time / (s.distance / 1000))
  const paceVariation = paces.length > 1 ? Math.max(...paces) - Math.min(...paces) : 0
  const workoutType = paceVariation > 45 ? 'intervals' : paceVariation > 20 ? 'tempo' : 'steady'

  return {
    strava_id: String(activity.id),
    user_id: ATHLETE_USER_ID,
    date,
    name: activity.name,
    type: activity.type,
    distance_km: activity.distance ? (activity.distance / 1000).toFixed(2) : null,
    duration_min: activity.moving_time ? Math.round(activity.moving_time / 60) : null,
    avg_hr: activity.average_heartrate || null,
    max_hr: activity.max_heartrate || null,
    elevation_m: activity.total_elevation_gain || null,
    pace_per_km: pacePerKm,
    avg_cadence: activity.average_cadence || null,
    calories: activity.calories || null,
    workout_type: workoutType,
    raw_data: {
      splits_metric: splits,
      laps: activity.laps || [],
      pace_variation: Math.round(paceVariation),
      workout_type: workoutType,
    },
    enrichment_status: 'pending',
  }
}

// ── Supabase upsert ───────────────────────────────────────────────────────────

function supabaseHeaders() {
  return {
    'Content-Type': 'application/json',
    'apikey': process.env.SUPABASE_SECRET_KEY,
    'Authorization': `Bearer ${process.env.SUPABASE_SECRET_KEY}`,
  }
}

async function upsertActivity(activityRow) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/activities`, {
    method: 'POST',
    headers: {
      ...supabaseHeaders(),
      'Prefer': 'resolution=merge-duplicates',
    },
    body: JSON.stringify(activityRow),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Supabase activity upsert failed ${res.status}: ${body}`)
  }
}

// ── Handle activity:update ────────────────────────────────────────────────────

async function handleUpdate(activityId) {
  const token = await getStravaToken()
  const activity = await fetchActivity(activityId, token)
  const row = buildActivityRow(activity)
  // On update, preserve enrichment_status as-is (don't reset to pending)
  delete row.enrichment_status
  await upsertActivity(row)
  console.log(`[strava-webhook] Updated activity ${activityId}`)
}

// ── Core processing (Stage 1) ─────────────────────────────────────────────────

async function processNewActivity(activityId) {
  console.log(`[strava-webhook] Stage 1: processing activity ${activityId}`)

  let activityRow
  try {
    const token = await getStravaToken()
    const activity = await fetchActivity(activityId, token)
    activityRow = buildActivityRow(activity)
    console.log(`[strava-webhook] Fetched: "${activity.name}" (${activity.type})`)
  } catch (err) {
    console.error(`[strava-webhook] Strava fetch failed — writing minimal failed row:`, err.message)
    // Write a minimal row so Stage 2 can detect failure
    activityRow = {
      strava_id: String(activityId),
      user_id: ATHLETE_USER_ID,
      date: viennaDate(Date.now()),
      name: `Activity ${activityId}`,
      enrichment_status: 'failed',
    }
  }

  await upsertActivity(activityRow)
  console.log(`[strava-webhook] Stage 1 complete: ${activityRow.strava_id} (${activityRow.enrichment_status})`)
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  // GET — Strava webhook verification handshake
  if (req.method === 'GET') {
    const mode      = req.query['hub.mode']
    const challenge = req.query['hub.challenge']
    const token     = req.query['hub.verify_token']

    if (mode === 'subscribe' && token === process.env.STRAVA_VERIFY_TOKEN) {
      console.log('[strava-webhook] Verification handshake OK')
      return res.status(200).json({ 'hub.challenge': challenge })
    }
    return res.status(403).json({ error: 'Forbidden' })
  }

  // POST — Activity notification
  if (req.method === 'POST') {
    const { object_type, object_id, aspect_type } = req.body || {}

    // Ignore non-activity events
    if (object_type !== 'activity') {
      console.log(`[strava-webhook] Ignored: ${object_type}/${aspect_type}`)
      return res.status(200).json({ received: true })
    }

    try {
      if (aspect_type === 'create') {
        await processNewActivity(object_id)
      } else if (aspect_type === 'update') {
        await handleUpdate(object_id)
      } else {
        console.log(`[strava-webhook] Ignored aspect_type: ${aspect_type}`)
      }
    } catch (err) {
      console.error(`[strava-webhook] Failed for activity ${object_id}:`, err.message)
      // Always return 200 to Strava — never let them see a 5xx
    }
    return res.status(200).json({ received: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
