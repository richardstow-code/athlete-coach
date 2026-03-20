/**
 * Vercel Serverless Function — Strava Webhook Handler
 *
 * Replaces the n8n Strava sync workflow.
 * Handles:
 *   GET  — Strava verification handshake
 *   POST — New activity notification → enrich → Claude feedback → Supabase
 */

const SUPABASE_URL = 'https://yjuhzmknabedjklsgbje.supabase.co'
const TZ = 'Europe/Vienna'
// Single-user app — user_id required for RLS-aware tables even with service_role
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

// ── Enrichment: pace variation, workout classification ───────────────────────

function enrichActivity(activity) {
  const splits = activity.splits_metric || []

  let paceVariation = 0
  if (splits.length > 1) {
    const paces = splits
      .filter(s => s.distance > 100 && s.moving_time > 0)
      .map(s => s.moving_time / (s.distance / 1000)) // sec/km
    if (paces.length > 1) {
      paceVariation = Math.max(...paces) - Math.min(...paces)
    }
  }

  const workoutType = paceVariation > 45 ? 'intervals'
    : paceVariation > 20 ? 'tempo'
    : 'steady'

  const rawData = {
    splits_metric: splits,
    laps: activity.laps || [],
    zones: activity.zones || null,
    pace_variation: Math.round(paceVariation),
    workout_type: workoutType,
  }

  // Parse pace from splits for display (fastest split as benchmark)
  let pacePerKm = null
  if (activity.average_speed && activity.average_speed > 0) {
    const secPerKm = 1000 / activity.average_speed
    const mins = Math.floor(secPerKm / 60)
    const secs = Math.round(secPerKm % 60)
    pacePerKm = `${mins}:${String(secs).padStart(2, '0')}`
  }

  // date: use start_date_local YYYY-MM-DD portion (already local time from Strava)
  const date = activity.start_date_local
    ? activity.start_date_local.slice(0, 10)
    : viennaDate(activity.start_date ? new Date(activity.start_date).getTime() : Date.now())

  return {
    activityRow: {
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
      raw_data: rawData,
    },
    enriched: { splits, workoutType, paceVariation: Math.round(paceVariation) },
  }
}

// ── Claude coaching feedback ──────────────────────────────────────────────────

async function generateFeedback(activityRow, enriched) {
  const splitsText = enriched.splits.slice(0, 10).map((s, i) => {
    if (!s.distance || !s.moving_time) return null
    const pace = s.moving_time / (s.distance / 1000)
    const paceMin = Math.floor(pace / 60)
    const paceSec = Math.round(pace % 60)
    const hr = s.average_heartrate ? ` | HR ${Math.round(s.average_heartrate)}` : ''
    return `  km${i + 1}: ${paceMin}:${String(paceSec).padStart(2, '0')}/km${hr}`
  }).filter(Boolean).join('\n')

  const prompt = `You are a marathon coach. Analyse this activity and give 2-3 sentences of direct feedback covering effort level, HR zone discipline (Z2 ceiling is 140bpm for easy runs), and one specific takeaway. Be direct, no softening.

Activity: ${activityRow.type}, ${activityRow.distance_km}km, ${activityRow.duration_min}min
Avg HR: ${activityRow.avg_hr || 'N/A'} | Max HR: ${activityRow.max_hr || 'N/A'} | Elevation: ${activityRow.elevation_m || 0}m
Pace: ${activityRow.pace_per_km || 'N/A'}/km
Workout type: ${enriched.workoutType}${enriched.paceVariation > 0 ? ` (pace variation: ${enriched.paceVariation}s/km)` : ''}
${splitsText ? `\nSplits:\n${splitsText}` : ''}

Athlete context: 79kg male, marathon training, target Munich Marathon 12 Oct 2026, goal sub-3:00.`

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.VITE_ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  if (!res.ok) throw new Error(`Claude call failed: ${res.status}`)
  const data = await res.json()
  return data.content?.[0]?.text || ''
}

// ── Supabase writes ───────────────────────────────────────────────────────────

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

async function insertCoachingMemory(activityId, date, feedback) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/coaching_memory`, {
    method: 'POST',
    headers: supabaseHeaders(),
    body: JSON.stringify({
      source: 'activity-trigger',
      category: 'activity_feedback',
      content: feedback,
      activity_id: parseInt(activityId, 10),
      date,
      user_id: ATHLETE_USER_ID,
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Supabase coaching_memory insert failed ${res.status}: ${body}`)
  }
}

// ── Core processing ───────────────────────────────────────────────────────────

async function processActivity(activityId) {
  console.log(`[strava-webhook] Processing activity ${activityId}`)

  // 1. Get Strava access token
  const token = await getStravaToken()

  // 2. Fetch full activity
  const activity = await fetchActivity(activityId, token)
  console.log(`[strava-webhook] Fetched: "${activity.name}" (${activity.type})`)

  // 3. Enrich
  const { activityRow, enriched } = enrichActivity(activity)

  // 4. Upsert to Supabase (essential — do this before Claude call)
  await upsertActivity(activityRow)
  console.log(`[strava-webhook] Activity saved: ${activityRow.strava_id}`)

  // 5. Claude feedback (optional — don't fail the whole flow if this fails)
  let feedback = ''
  try {
    feedback = await generateFeedback(activityRow, enriched)
    if (feedback) {
      await insertCoachingMemory(activityRow.strava_id, activityRow.date, feedback)
      console.log(`[strava-webhook] Coaching feedback saved`)
    }
  } catch (e) {
    console.error(`[strava-webhook] Coaching feedback failed (activity still saved):`, e.message)
  }
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

    // Ignore non-activity events immediately
    if (object_type !== 'activity' || aspect_type !== 'create') {
      console.log(`[strava-webhook] Ignored: ${object_type}/${aspect_type}`)
      return res.status(200).json({ received: true })
    }

    // Process synchronously so Vercel doesn't kill the function after response.
    // Strava retries are safe — upsert on strava_id prevents duplicates.
    try {
      await processActivity(object_id)
    } catch (err) {
      console.error(`[strava-webhook] Processing failed for activity ${object_id}:`, err.message)
      // Still return 200 — never let Strava see a 5xx
    }
    return res.status(200).json({ received: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
