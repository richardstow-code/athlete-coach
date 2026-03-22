/**
 * enrich-activity — Stage 2 of the webhook pipeline
 *
 * Triggered by a Supabase database webhook on activities INSERT.
 * Payload: { type: "INSERT", table: "activities", record: { ...row }, schema: "public" }
 *
 * Steps:
 *   B1. Validate webhook secret + extract activity info
 *   B2. Refresh Strava token from strava_tokens table
 *   B3. Fetch 5 stream types from Strava
 *   B4. Downsample to 10-second resolution
 *   B5. Compute zone time, cadence stats, grade correlation
 *   B6. Write to activity_streams + update activities row
 *   B7. Generate coaching feedback via Claude
 *   B8. Error handling — each stage is independently wrapped
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ENRICH_WEBHOOK_SECRET = Deno.env.get('ENRICH_WEBHOOK_SECRET') ?? ''
const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY')!
const ATHLETE_USER_ID = '40cfe68e-faea-491c-b410-0093572f02d6'

// ── Default HR zones (from system prompt) ────────────────────────────────────

const DEFAULT_ZONES = {
  z1: { min: 0,   max: 124 },
  z2: { min: 125, max: 140 },
  z3: { min: 141, max: 158 },
  z4: { min: 159, max: 172 },
  z5: { min: 173, max: 999 },
}

// ── Strava token management ───────────────────────────────────────────────────

async function getValidStravaToken(supabase: ReturnType<typeof createClient>, userId: string): Promise<string> {
  const { data: tokenRow, error } = await supabase
    .from('strava_tokens')
    .select('*')
    .eq('user_id', userId)
    .single()

  if (error || !tokenRow) throw new Error('No Strava token for user')

  if (tokenRow.expires_at < Math.floor(Date.now() / 1000) + 300) {
    const res = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: Deno.env.get('STRAVA_CLIENT_ID'),
        client_secret: Deno.env.get('STRAVA_CLIENT_SECRET'),
        refresh_token: tokenRow.refresh_token,
        grant_type: 'refresh_token',
      }),
    })
    if (!res.ok) throw new Error('Token refresh failed')
    const refreshed = await res.json()
    await supabase.from('strava_tokens').update({
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token,
      expires_at: refreshed.expires_at,
      updated_at: new Date().toISOString(),
    }).eq('user_id', userId)
    return refreshed.access_token
  }

  return tokenRow.access_token
}

// ── Fetch streams from Strava ─────────────────────────────────────────────────

async function fetchStreams(stravaId: string, token: string): Promise<Record<string, number[]>> {
  const keys = 'heartrate,cadence,altitude,velocity_smooth,latlng'
  const res = await fetch(
    `https://www.strava.com/api/v3/activities/${stravaId}/streams?keys=${keys}&key_by_type=true`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (!res.ok) throw new Error(`Strava streams fetch failed: ${res.status}`)
  return res.json()
}

// ── Downsample to 10-second resolution ───────────────────────────────────────

function downsample(streams: Record<string, { data: unknown[] }>) {
  const hr  = streams.heartrate?.data as number[] | null  ?? null
  const cad = streams.cadence?.data  as number[] | null  ?? null
  const alt = streams.altitude?.data as number[] | null  ?? null
  const vel = streams.velocity_smooth?.data as number[] | null ?? null
  const ll  = streams.latlng?.data   as [number,number][] | null ?? null

  const len = hr?.length ?? cad?.length ?? alt?.length ?? vel?.length ?? ll?.length ?? 0
  if (len === 0) return []

  const samples = []
  for (let i = 0; i < len; i += 10) {
    // velocity_smooth: average the 10 surrounding points
    let velVal: number | null = null
    if (vel) {
      const chunk = vel.slice(i, i + 10).filter(v => v != null)
      velVal = chunk.length > 0 ? chunk.reduce((s, v) => s + v, 0) / chunk.length : null
    }

    const sample: Record<string, number | null> = { t: i }
    if (hr)  sample.hr  = hr[i]  ?? null
    if (cad) sample.cad = cad[i] ?? null
    if (alt) sample.alt = alt[i] ?? null
    if (vel) sample.vel = velVal != null ? parseFloat(velVal.toFixed(3)) : null
    if (ll)  { sample.lat = ll[i]?.[0] ?? null; sample.lng = ll[i]?.[1] ?? null }

    samples.push(sample)
  }
  return samples
}

// ── Compute derived metrics ───────────────────────────────────────────────────

function computeZoneSeconds(samples: Record<string, number | null>[], zones: typeof DEFAULT_ZONES) {
  const zoneSecs = { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 }
  for (const s of samples) {
    const hr = s.hr
    if (!hr) continue
    const interval = 10 // each sample represents 10 seconds
    if (hr <= zones.z1.max)                       zoneSecs.z1 += interval
    else if (hr >= zones.z2.min && hr <= zones.z2.max) zoneSecs.z2 += interval
    else if (hr >= zones.z3.min && hr <= zones.z3.max) zoneSecs.z3 += interval
    else if (hr >= zones.z4.min && hr <= zones.z4.max) zoneSecs.z4 += interval
    else if (hr >= zones.z5.min)                  zoneSecs.z5 += interval
  }
  return zoneSecs
}

function computeCadenceStats(samples: Record<string, number | null>[]) {
  const cadValues = samples.map(s => s.cad).filter((v): v is number => v != null && v > 0)
  if (cadValues.length === 0) return null
  const avg = Math.round(cadValues.reduce((s, v) => s + v, 0) / cadValues.length)
  // Split into 5 equal segments
  const segSize = Math.ceil(cadValues.length / 5)
  const trend = []
  for (let i = 0; i < 5; i++) {
    const seg = cadValues.slice(i * segSize, (i + 1) * segSize)
    if (seg.length > 0) trend.push(Math.round(seg.reduce((s, v) => s + v, 0) / seg.length))
  }
  return { avg, trend }
}

function computeGradeCorrelation(samples: Record<string, number | null>[]) {
  const points = samples.filter(s => s.alt != null && s.vel != null)
  if (points.length < 3) return null

  let sumGrade = 0, sumVel = 0, sumGV = 0, sumG2 = 0, sumV2 = 0, n = 0
  for (let i = 1; i < points.length; i++) {
    const altDelta = (points[i].alt ?? 0) - (points[i-1].alt ?? 0)
    const timeDelta = 10
    const dist = ((points[i].vel ?? 0) + (points[i-1].vel ?? 0)) / 2 * timeDelta
    if (dist < 0.1) continue
    const grade = (altDelta / dist) * 100
    const v = points[i].vel ?? 0
    sumGrade += grade; sumVel += v; sumGV += grade * v
    sumG2 += grade * grade; sumV2 += v * v; n++
  }
  if (n < 3) return null
  const numerator = n * sumGV - sumGrade * sumVel
  const denominator = Math.sqrt((n * sumG2 - sumGrade ** 2) * (n * sumV2 - sumVel ** 2))
  const correlation = denominator !== 0 ? numerator / denominator : 0
  return { correlation: parseFloat(correlation.toFixed(3)) }
}

// ── Coaching feedback via Claude ──────────────────────────────────────────────

async function generateCoachingFeedback(
  activityRow: Record<string, unknown>,
  zoneSecs: Record<string, number>,
  cadenceStats: { avg: number; trend: number[] } | null,
  gradeCorr: { correlation: number } | null,
  settings: Record<string, unknown> | null,
  plannedSession: Record<string, unknown> | null,
  zones: typeof DEFAULT_ZONES,
): Promise<string> {
  const totalSecs = Object.values(zoneSecs).reduce((s, v) => s + v, 0)
  const zonePct = (z: string) => totalSecs > 0 ? Math.round((zoneSecs[z] / totalSecs) * 100) : 0
  const formatSecs = (s: number) => `${Math.floor(s/60)}m${s%60 > 0 ? (s%60)+'s' : ''}`

  const zoneLines = totalSecs > 0
    ? `Z1 ${formatSecs(zoneSecs.z1)} (${zonePct('z1')}%) | Z2 ${formatSecs(zoneSecs.z2)} (${zonePct('z2')}%) | Z3 ${formatSecs(zoneSecs.z3)} (${zonePct('z3')}%) | Z4 ${formatSecs(zoneSecs.z4)} (${zonePct('z4')}%) | Z5 ${formatSecs(zoneSecs.z5)} (${zonePct('z5')}%)`
    : 'No HR data'

  const cadLine = cadenceStats
    ? `Avg cadence: ${cadenceStats.avg}spm | Trend across activity: [${cadenceStats.trend.join(', ')}]`
    : 'No cadence data'

  const gradeLine = gradeCorr
    ? `Grade-velocity correlation: ${gradeCorr.correlation.toFixed(2)} (${gradeCorr.correlation < -0.5 ? 'strong pace penalty on hills' : gradeCorr.correlation < -0.2 ? 'moderate pace penalty on hills' : 'minimal grade effect'})`
    : ''

  const zoneStr = `Z1 <${zones.z1.max}bpm, Z2 ${zones.z2.min}-${zones.z2.max}bpm, Z3 ${zones.z3.min}-${zones.z3.max}bpm, Z4 ${zones.z4.min}-${zones.z4.max}bpm, Z5 >${zones.z5.min}bpm`

  const tone = (settings?.tone as number) ?? 50
  const toneGuide = tone < 25 ? 'Be brutally direct — call out failures plainly.'
    : tone < 50 ? 'Be direct and honest.'
    : tone < 75 ? 'Be warm but firm.'
    : 'Be encouragingly British — dry humour, firm guidance.'

  const detailLevel = (settings?.detail_level as number) ?? 50
  const detailGuide = detailLevel < 33 ? 'One key insight only — lead with it.'
    : detailLevel < 66 ? '2-3 points with supporting data.'
    : 'Full analysis with zone breakdown and cadence interpretation.'

  const plannedLine = plannedSession
    ? `Today's planned session: ${plannedSession.name} (${plannedSession.session_type || 'unknown type'}, ${plannedSession.zone || ''}, ${plannedSession.duration_min_low || '?'}-${plannedSession.duration_min_high || '?'}min)`
    : 'No planned session found for today.'

  const prompt = `You are an endurance coach reviewing a completed activity. Give concise, direct coaching feedback.

ACTIVITY: ${activityRow.name} — ${activityRow.type}
Distance: ${activityRow.distance_km}km | Duration: ${activityRow.duration_min}min | Pace: ${activityRow.pace_per_km || 'N/A'}/km
Avg HR: ${activityRow.avg_hr || 'N/A'} | Max HR: ${activityRow.max_hr || 'N/A'} | Elevation: ${activityRow.elevation_m || 0}m

HR ZONES (athlete's zones: ${zoneStr}):
${zoneLines}

CADENCE: ${cadLine}
${gradeLine ? `GRADE EFFECT: ${gradeLine}` : ''}

PLANNED: ${plannedLine}

Focus on: (1) Zone discipline — was the effort appropriate for the intent? (2) Cadence quality if available. (3) Grade impact if relevant. (4) One specific takeaway. ${detailGuide} ${toneGuide}`

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 350,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  if (!res.ok) throw new Error(`Claude API failed: ${res.status}`)
  const data = await res.json()
  if (data?.type === 'error') throw new Error(data.error?.message || 'Claude error')
  return data.content?.[0]?.text || ''
}

// ── Main handler ──────────────────────────────────────────────────────────────

serve(async (req) => {
  // B1. Validate webhook secret
  const secret = req.headers.get('x-webhook-secret') ?? ''
  if (ENRICH_WEBHOOK_SECRET && secret !== ENRICH_WEBHOOK_SECRET) {
    console.error('[enrich-activity] Invalid webhook secret')
    return new Response('Forbidden', { status: 403 })
  }

  let payload: Record<string, unknown>
  try {
    payload = await req.json()
  } catch {
    return new Response('Bad request', { status: 400 })
  }

  // Only handle INSERT events
  if (payload.type !== 'INSERT') {
    return new Response('OK', { status: 200 })
  }

  const record = payload.record as Record<string, unknown>
  const userId = record.user_id as string
  const activityId = record.id as number   // Supabase bigint PK
  const stravaId = String(record.strava_id)
  const date = String(record.date || '').slice(0, 10)

  // Safety: single-user app guard
  if (userId !== ATHLETE_USER_ID) {
    console.log(`[enrich-activity] Skipping non-athlete user: ${userId}`)
    return new Response('OK', { status: 200 })
  }

  // Skip if already failed in Stage 1
  if (record.enrichment_status === 'failed') {
    console.log(`[enrich-activity] Skipping failed activity: ${stravaId}`)
    return new Response('OK', { status: 200 })
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  // Mark as processing
  await supabase.from('activities').update({ enrichment_status: 'processing' }).eq('id', activityId)
  console.log(`[enrich-activity] Processing activity ${stravaId}`)

  // B2. Get Strava token
  let accessToken: string
  try {
    accessToken = await getValidStravaToken(supabase, userId)
  } catch (err) {
    console.error('[enrich-activity] Token fetch failed:', err.message)
    await supabase.from('activities').update({ enrichment_status: 'failed' }).eq('id', activityId)
    return new Response('OK', { status: 200 })
  }

  // B3+B4+B5: Fetch streams, downsample, compute metrics
  let samples: Record<string, number | null>[] = []
  let zoneSecs = { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 }
  let cadenceStats: { avg: number; trend: number[] } | null = null
  let gradeCorr: { correlation: number } | null = null

  // Load athlete zones for computation
  let zones = DEFAULT_ZONES
  try {
    const { data: settingsRow } = await supabase.from('athlete_settings').select('hr_zones, training_zones').eq('user_id', userId).maybeSingle()
    if (settingsRow?.hr_zones?.zones) {
      zones = settingsRow.hr_zones.zones
    } else if (settingsRow?.training_zones) {
      const tz = settingsRow.training_zones
      zones = {
        z1: { min: 0,             max: tz.z1_max ?? 124 },
        z2: { min: tz.z2_min ?? 125, max: tz.z2_max ?? 140 },
        z3: { min: tz.z3_min ?? 141, max: tz.z3_max ?? 158 },
        z4: { min: tz.z4_min ?? 159, max: tz.z4_max ?? 172 },
        z5: { min: tz.z5_min ?? 173, max: 999 },
      }
    }
  } catch { /* use defaults */ }

  try {
    const rawStreams = await fetchStreams(stravaId, accessToken)
    samples = downsample(rawStreams as Record<string, { data: unknown[] }>)
    zoneSecs = computeZoneSeconds(samples, zones)
    cadenceStats = computeCadenceStats(samples)
    gradeCorr = computeGradeCorrelation(samples)
  } catch (err) {
    console.error('[enrich-activity] Streams fetch/compute failed:', err.message)
    // Continue — will still write what we have and attempt coaching feedback
  }

  // B6: Write to activity_streams and update activities
  try {
    if (samples.length > 0) {
      await supabase.from('activity_streams').upsert({
        user_id: userId,
        activity_id: activityId,
        strava_id: parseInt(stravaId, 10),
        samples,
        zone_seconds: zoneSecs,
        cadence_stats: cadenceStats,
        grade_correlation: gradeCorr,
      }, { onConflict: 'activity_id' })
    }

    await supabase.from('activities').update({
      enrichment_status: 'complete',
      zone_data: zoneSecs,
    }).eq('id', activityId)

    console.log(`[enrich-activity] Streams written: ${samples.length} samples`)
  } catch (err) {
    console.error('[enrich-activity] DB write failed:', err.message)
    await supabase.from('activities').update({ enrichment_status: 'failed' }).eq('id', activityId)
  }

  // B7: Coaching feedback — independent of stream write
  try {
    // Fetch settings and today's planned session for context
    const today = date || new Date().toISOString().slice(0, 10)
    const [{ data: settings }, { data: sessions }] = await Promise.all([
      supabase.from('athlete_settings').select('name, weight_kg, goal_type, tone, consequences, detail_level, coaching_reach').eq('user_id', userId).maybeSingle(),
      supabase.from('scheduled_sessions').select('name, session_type, zone, duration_min_low, duration_min_high').eq('planned_date', today).limit(1),
    ])

    const feedback = await generateCoachingFeedback(
      record,
      zoneSecs,
      cadenceStats,
      gradeCorr,
      settings,
      sessions?.[0] || null,
      zones,
    )

    if (feedback) {
      await supabase.from('coaching_memory').insert({
        type: 'activity_feedback',
        source: 'activity-trigger',
        category: 'activity_feedback',
        content: feedback,
        activity_id: parseInt(stravaId, 10),
        date: today,
        user_id: userId,
      })
      console.log('[enrich-activity] Coaching feedback written')
    }
  } catch (err) {
    console.error('[enrich-activity] Coaching feedback failed (streams still saved):', err.message)
  }

  // Auto-trigger zone calibration every 10th activity
  try {
    const { count } = await supabase
      .from('activities')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('enrichment_status', 'complete')
    if (count && count % 10 === 0) {
      console.log('[enrich-activity] Auto-triggering zone calibration')
      await fetch(`${SUPABASE_URL}/functions/v1/calibrate-zones`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
          'apikey': SUPABASE_SERVICE_KEY,
        },
        body: JSON.stringify({ user_id: userId, method: 'both' }),
      })
    }
  } catch { /* non-fatal */ }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
