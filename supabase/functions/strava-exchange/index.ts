import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    // Verify the calling user via their Supabase JWT
    const jwt = req.headers.get('Authorization')?.replace('Bearer ', '')
    if (!jwt) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data: { user }, error: authError } = await supabase.auth.getUser(jwt)
    if (authError || !user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })

    const { code, redirect_uri } = await req.json()
    if (!code) return new Response(JSON.stringify({ error: 'Missing code' }), { status: 400, headers: corsHeaders })

    // Exchange code for tokens
    const tokenRes = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: Deno.env.get('STRAVA_CLIENT_ID'),
        client_secret: Deno.env.get('STRAVA_CLIENT_SECRET'),
        code,
        grant_type: 'authorization_code',
        redirect_uri,
      }),
    })

    if (!tokenRes.ok) {
      const err = await tokenRes.text()
      return new Response(JSON.stringify({ error: 'Strava token exchange failed', detail: err }), { status: 400, headers: corsHeaders })
    }

    const token = await tokenRes.json()

    // Store in strava_tokens keyed by user_id
    const { error: upsertError } = await supabase.from('strava_tokens').upsert({
      user_id: user.id,
      athlete_id: token.athlete.id,
      athlete_name: `${token.athlete.firstname} ${token.athlete.lastname}`.trim(),
      access_token: token.access_token,
      refresh_token: token.refresh_token,
      expires_at: token.expires_at,
      scope: token.scope ?? 'activity:read_all',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })

    if (upsertError) throw upsertError

    return new Response(
      JSON.stringify({ athlete_id: token.athlete.id, athlete_name: `${token.athlete.firstname} ${token.athlete.lastname}`.trim() }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
