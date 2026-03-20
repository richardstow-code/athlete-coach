import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Strava sends a GET with hub.challenge to verify the endpoint
// Strava sends a POST with event data when an activity is created/updated/deleted

const VERIFY_TOKEN = 'coach_claude_webhook_2026'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  // ── Webhook verification (GET) ────────────────────────────────────────────
  if (req.method === 'GET') {
    const url = new URL(req.url)
    const mode = url.searchParams.get('hub.mode')
    const token = url.searchParams.get('hub.verify_token')
    const challenge = url.searchParams.get('hub.challenge')

    if (mode === 'subscribe' && token === VERIFY_TOKEN && challenge) {
      return new Response(
        JSON.stringify({ 'hub.challenge': challenge }),
        { headers: { 'Content-Type': 'application/json' } },
      )
    }
    return new Response('Forbidden', { status: 403 })
  }

  // ── Activity event (POST) ─────────────────────────────────────────────────
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  try {
    const event = await req.json()
    // event shape: { object_type, object_id, aspect_type, owner_id, subscription_id, event_time }

    // Only handle activity create/update, not delete
    if (event.object_type !== 'activity' || event.aspect_type === 'delete') {
      return new Response(JSON.stringify({ ok: true, skipped: true }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const stravaActivityId = event.object_id
    const stravaAthleteId = event.owner_id

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Look up which user owns this Strava athlete_id
    const { data: tokenRow } = await supabase
      .from('strava_tokens')
      .select('user_id, access_token, refresh_token, expires_at')
      .eq('athlete_id', stravaAthleteId)
      .maybeSingle()

    if (!tokenRow) {
      return new Response(JSON.stringify({ ok: true, skipped: 'no_token' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Refresh token if needed
    let accessToken = tokenRow.access_token
    if (tokenRow.expires_at < Math.floor(Date.now() / 1000) + 300) {
      const refreshRes = await fetch('https://www.strava.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: Deno.env.get('STRAVA_CLIENT_ID'),
          client_secret: Deno.env.get('STRAVA_CLIENT_SECRET'),
          refresh_token: tokenRow.refresh_token,
          grant_type: 'refresh_token',
        }),
      })
      if (refreshRes.ok) {
        const refreshed = await refreshRes.json()
        accessToken = refreshed.access_token
        await supabase.from('strava_tokens').update({
          access_token: refreshed.access_token,
          refresh_token: refreshed.refresh_token,
          expires_at: refreshed.expires_at,
          updated_at: new Date().toISOString(),
        }).eq('user_id', tokenRow.user_id)
      }
    }

    // Fetch the specific activity from Strava
    const actRes = await fetch(
      `https://www.strava.com/api/v3/activities/${stravaActivityId}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    )
    if (!actRes.ok) throw new Error(`Strava activity fetch failed: ${actRes.status}`)

    const a = await actRes.json()

    const row = {
      user_id: tokenRow.user_id,
      strava_id: String(a.id),
      date: (a.start_date_local as string).slice(0, 10),
      name: a.name,
      type: ((a.sport_type as string) ?? (a.type as string) ?? '').toLowerCase(),
      distance_km: a.distance ? Number(((a.distance as number) / 1000).toFixed(2)) : null,
      duration_min: a.moving_time ? Number(((a.moving_time as number) / 60).toFixed(1)) : null,
      pace_per_km: (a.distance && a.moving_time)
        ? (() => {
            const secsPerKm = (a.moving_time as number) / ((a.distance as number) / 1000)
            return `${Math.floor(secsPerKm / 60)}:${String(Math.round(secsPerKm % 60)).padStart(2, '0')}`
          })()
        : null,
      avg_hr: a.average_heartrate ?? null,
      max_hr: a.max_heartrate ?? null,
      elevation_m: a.total_elevation_gain ?? null,
      calories: a.calories ?? null,
      avg_cadence: a.average_cadence ?? null,
      workout_type: a.workout_type ?? null,
      splits_metric: a.splits_metric ?? null,
      laps: a.laps ?? null,
      raw_data: a,
    }

    const { error } = await supabase
      .from('activities')
      .upsert(row, { onConflict: 'strava_id' })

    if (error) throw error

    return new Response(
      JSON.stringify({ ok: true, activity_id: stravaActivityId, user_id: tokenRow.user_id }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    // Always return 200 to Strava so it doesn't retry indefinitely
    return new Response(
      JSON.stringify({ ok: false, error: err.message }),
      { headers: { 'Content-Type': 'application/json' }, status: 200 },
    )
  }
})
