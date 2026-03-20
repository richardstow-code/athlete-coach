// Registers (or replaces) the Strava webhook subscription.
// Pass ?replace=true to delete existing subscription first.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

serve(async (req) => {
  const clientId = Deno.env.get('STRAVA_CLIENT_ID')
  const clientSecret = Deno.env.get('STRAVA_CLIENT_SECRET')
  const callbackUrl = 'https://yjuhzmknabedjklsgbje.supabase.co/functions/v1/strava-webhook'
  const verifyToken = 'coach_claude_webhook_2026'
  const url = new URL(req.url)
  const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {}
  const replace = url.searchParams.get('replace') === 'true' || body.replace === true

  // Check existing subscription
  const checkRes = await fetch(
    `https://www.strava.com/api/v3/push_subscriptions?client_id=${clientId}&client_secret=${clientSecret}`,
  )
  const existing = await checkRes.json()

  if (Array.isArray(existing) && existing.length > 0) {
    if (!replace) {
      return new Response(JSON.stringify({ status: 'already_registered', subscriptions: existing }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }
    // Delete all existing subscriptions
    for (const sub of existing) {
      await fetch(
        `https://www.strava.com/api/v3/push_subscriptions/${sub.id}?client_id=${clientId}&client_secret=${clientSecret}`,
        { method: 'DELETE' },
      )
    }
  }

  // Register new subscription
  const regRes = await fetch('https://www.strava.com/api/v3/push_subscriptions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      callback_url: callbackUrl,
      verify_token: verifyToken,
    }),
  })

  const result = await regRes.json()
  return new Response(JSON.stringify({ status: regRes.ok ? 'registered' : 'failed', result, deleted_old: replace }), {
    headers: { 'Content-Type': 'application/json' },
    status: 200,
  })
})
