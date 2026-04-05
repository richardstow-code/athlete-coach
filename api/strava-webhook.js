/**
 * Vercel Serverless Function — Strava Webhook Handler (Stage 1)
 *
 * Stage 1 only: receive event → look up user → fetch activity
 * → write to DB with enrichment_status='pending' → return 200.
 *
 * Stage 2 (enrichment, streams, coaching feedback) is handled by
 * the Supabase edge function `enrich-activity`, triggered by a
 * Supabase database trigger on activities INSERT.
 *
 * Multi-user: routes by Strava owner_id → strava_tokens table.
 * No hardcoded user IDs or single-user refresh tokens.
 */

const SUPABASE_URL = 'https://yjuhzmknabedjklsgbje.supabase.co'
const TZ = 'Europe/Vienna'

function viennaDate(ts) {
  return new Date(ts).toLocaleDateString('en-CA', { timeZone: TZ })
}

function supabaseHeaders() {
  return {
    'Content-Type': 'application/json',
    'apikey': process.env.SUPABASE_SECRET_KEY,
    'Authorization': `Bearer ${process.env.SUPABASE_SECRET_KEY}`,
  }
}

// ── Look up user by Strava athlete_id ────────────────────────────────────────

async function getUserForStravaAthlete(stravaAthleteId) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/strava_tokens?athlete_id=eq.${stravaAthleteId}&select=user_id,access_token,refresh_token,expires_at`,
    { headers: supabaseHeaders() }
  )
  if (!res.ok) throw new Error(`strava_tokens lookup failed: ${res.status}`)
  const rows = await res.json()
  if (!rows || rows.length === 0) {
    throw new Error(`No user found for Strava athlete_id ${stravaAthleteId}`)
  }
  return rows[0] // { user_id, access_token, refresh_token, expires_at }
}

// ── Get a valid Strava access token for a user ────────────────────────────────
// Refreshes automatically if expired, updates strava_tokens table.

async function getStravaTokenForUser(tokenRow) {
  const { user_id, access_token, refresh_token, expires_at } = tokenRow

  // expires_at is a Unix timestamp (seconds). Refresh if within 5 minutes of expiry.
  const nowSec = Math.floor(Date.now() / 1000)
  if (expires_at && nowSec < expires_at - 300) {
    return access_token // still valid
  }

  // Token expired — refresh it
  console.log(`[strava-webhook] Refreshing token for user ${user_id}`)
  const refreshRes = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      refresh_token,
      grant_type: 'refresh_token',
    }),
  })
  if (!refreshRes.ok) throw new Error(`Strava token refresh failed: ${refreshRes.status}`)
  const refreshData = await refreshRes.json()

  // Update strava_tokens table with new tokens
  const updateRes = await fetch(
    `${SUPABASE_URL}/rest/v1/strava_tokens?user_id=eq.${user_id}`,
    {
      method: 'PATCH',
      headers: supabaseHeaders(),
      body: JSON.stringify({
        access_token: refreshData.access_token,
        refresh_token: refreshData.refresh_token,
        expires_at: refreshData.expires_at,
        updated_at: new Date().toISOString(),
      }),
    }
  )
  if (!updateRes.ok) {
    const body = await updateRes.text()
    console.error(`[strava-webhook] Failed to update token in DB: ${body}`)
  }

  return refreshData.access_token
}

// ── Fetch full activity from Strava ──────────────────────────────────────────

async function fetchActivity(activityId, token) {
  const res = await fetch(`https://www.strava.com/api/v3/activities/${activityId}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`Strava activity fetch failed: ${res.status}`)
  return res.json()
}

// ── Build activity row for DB ─────────────────────────────────────────────────

function buildActivityRow(activity, userId) {
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
    user_id: userId,
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

async function handleUpdate(activityId, stravaAthleteId) {
  const tokenRow = await getUserForStravaAthlete(stravaAthleteId)
  const token = await getStravaTokenForUser(tokenRow)
  const activity = await fetchActivity(activityId, token)
  const row = buildActivityRow(activity, tokenRow.user_id)
  // On update, preserve enrichment_status — don't reset to pending
  delete row.enrichment_status
  await upsertActivity(row)
  console.log(`[strava-webhook] Updated activity ${activityId} for user ${tokenRow.user_id}`)
}

// ── Core processing (Stage 1) ─────────────────────────────────────────────────

async function processNewActivity(activityId, stravaAthleteId) {
  console.log(`[strava-webhook] Stage 1: activity ${activityId}, athlete ${stravaAthleteId}`)

  let activityRow
  try {
    const tokenRow = await getUserForStravaAthlete(stravaAthleteId)
    const token = await getStravaTokenForUser(tokenRow)
    const activity = await fetchActivity(activityId, token)
    activityRow = buildActivityRow(activity, tokenRow.user_id)
    console.log(`[strava-webhook] Fetched: "${activity.name}" for user ${tokenRow.user_id}`)
  } catch (err) {
    console.error(`[strava-webhook] Failed for activity ${activityId}:`, err.message)
    // If we can't resolve the user, we cannot write a meaningful row.
    // Return early — Strava will retry the webhook later.
    return
  }

  await upsertActivity(activityRow)
  console.log(`[strava-webhook] Stage 1 complete: ${activityRow.strava_id} (pending)`)
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
    const { object_type, object_id, aspect_type, owner_id } = req.body || {}

    // Ignore non-activity events
    if (object_type !== 'activity') {
      console.log(`[strava-webhook] Ignored: ${object_type}/${aspect_type}`)
      return res.status(200).json({ received: true })
    }

    // owner_id is the Strava athlete ID — used to route to the correct user
    if (!owner_id) {
      console.error('[strava-webhook] No owner_id in webhook body — cannot route')
      return res.status(200).json({ received: true })
    }

    try {
      if (aspect_type === 'create') {
        await processNewActivity(object_id, owner_id)
      } else if (aspect_type === 'update') {
        await handleUpdate(object_id, owner_id)
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
