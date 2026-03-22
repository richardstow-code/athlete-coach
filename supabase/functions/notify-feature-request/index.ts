import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ADMIN_EMAIL = Deno.env.get('ADMIN_EMAIL')
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { type, title, description, submitter_email, feature_id, priority } = await req.json()

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    // Always write to admin_notifications first (never lose a submission)
    const { error: dbErr } = await supabase
      .from('admin_notifications')
      .insert({
        type,        // 'feature' | 'bug' | 'vote'
        title,
        description,
        submitter_email: submitter_email || null,
        metadata: { feature_id: feature_id || null, priority: priority || 'normal' },
      })

    if (dbErr) {
      console.error('[notify-feature-request] DB insert failed:', dbErr.message)
      return new Response(JSON.stringify({ error: 'DB write failed' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Attempt email notification — non-fatal if it fails
    if (ADMIN_EMAIL && RESEND_API_KEY) {
      const typeLabel = type === 'bug' ? '🐛 Bug Report' : type === 'vote' ? '👍 Vote' : '✨ Feature Request'
      const priorityStr = priority && priority !== 'normal' ? ` [${priority.toUpperCase()}]` : ''
      const subject = `${typeLabel}${priorityStr}: ${title}`
      const body = [
        `<strong>Type:</strong> ${type}`,
        priority ? `<strong>Priority:</strong> ${priority}` : null,
        `<strong>Title:</strong> ${title}`,
        description ? `<strong>Description:</strong><br>${description.replace(/\n/g, '<br>')}` : null,
        submitter_email ? `<strong>Submitted by:</strong> ${submitter_email}` : null,
        feature_id ? `<strong>Feature ID:</strong> ${feature_id}` : null,
      ].filter(Boolean).join('<br><br>')

      try {
        const emailRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: 'coach-app@notifications.rstr.io',
            to: ADMIN_EMAIL,
            subject,
            html: `<div style="font-family: monospace; font-size: 14px; line-height: 1.6;">${body}</div>`,
          }),
        })
        if (!emailRes.ok) {
          const errText = await emailRes.text()
          console.warn('[notify-feature-request] Email failed:', errText)
        }
      } catch (emailErr) {
        console.warn('[notify-feature-request] Email error (non-fatal):', emailErr)
      }
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('[notify-feature-request] Unexpected error:', err)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
