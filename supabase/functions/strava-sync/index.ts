import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

async function getValidAccessToken(supabase: ReturnType<typeof createClient>, userId: string): Promise<string> {
  const { data: tokenRow, error } = await supabase
    .from('strava_tokens')
    .select('*')
    .eq('user_id', userId)
    .single()

  if (error || !tokenRow) throw new Error('No Strava token for user')

  // Refresh if expiring within 5 minutes
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

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const jwt = req.headers.get('Authorization')?.replace('Bearer ', '')
    if (!jwt) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data: { user }, error: authError } = await supabase.auth.getUser(jwt)
    if (authError || !user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })

    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {}
    // Default: sync last 90 days; caller can pass a unix timestamp to sync from
    const after: number = body.after ?? Math.floor((Date.now() - 90 * 24 * 60 * 60 * 1000) / 1000)

    const accessToken = await getValidAccessToken(supabase, user.id)

    // Fetch all pages of activities from Strava
    const activities = []
    let page = 1
    while (true) {
      const res = await fetch(
        `https://www.strava.com/api/v3/athlete/activities?after=${after}&per_page=100&page=${page}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      )
      if (!res.ok) throw new Error(`Strava API error: ${res.status}`)
      const batch = await res.json()
      if (!batch.length) break
      activities.push(...batch)
      if (batch.length < 100) break
      page++
    }

    if (!activities.length) {
      return new Response(JSON.stringify({ synced: 0 }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // Map Strava fields to the activities table schema
    const rows = activities.map((a: Record<string, unknown>) => ({
      user_id: user.id,
      strava_id: String(a.id),
      date: (a.start_date_local as string).slice(0, 10),
      name: a.name,
      type: (a.sport_type as string ?? a.type as string ?? '').toLowerCase(),
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
    }))

    const { error: upsertError } = await supabase
      .from('activities')
      .upsert(rows, { onConflict: 'strava_id' })

    if (upsertError) throw upsertError

    return new Response(
      JSON.stringify({ synced: rows.length }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
