import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY')!
  const todayStr = new Date().toISOString().slice(0, 10)

  try {
    // Fetch all active users who have athlete_settings
    const { data: users } = await supabase
      .from('athlete_settings')
      .select('user_id, name, goal_type, current_level, health_notes')

    if (!users?.length) {
      return new Response(JSON.stringify({ generated: 0 }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    let generated = 0

    for (const user of users) {
      // Skip if briefing already exists for today
      const { data: existing } = await supabase
        .from('daily_briefings')
        .select('id')
        .eq('user_id', user.user_id)
        .eq('date', todayStr)
        .maybeSingle()

      if (existing) continue

      // Fetch recent context
      const [{ data: activities }, { data: sports }] = await Promise.all([
        supabase
          .from('activities')
          .select('date, name, type, distance_km, elevation_m, avg_hr, duration_min, pace_per_km')
          .eq('user_id', user.user_id)
          .order('date', { ascending: false })
          .limit(7),
        supabase
          .from('athlete_sports')
          .select('sport_raw, sport_category, priority, current_goal_raw, target_date, lifecycle_state')
          .eq('user_id', user.user_id)
          .eq('is_active', true),
      ])

      // Build context string
      const primarySport = sports?.find(s => s.priority === 'primary') || sports?.[0]
      const targetDate = primarySport?.target_date
      const daysToTarget = targetDate
        ? Math.ceil((new Date(targetDate).getTime() - Date.now()) / 86400000)
        : null

      const activityLines = (activities || []).map(a =>
        `- ${new Date(a.date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}: ${a.name} ${a.distance_km ? a.distance_km + 'km' : ''} ${a.avg_hr ? 'HR ' + Math.round(a.avg_hr) : ''} ${a.duration_min ? Math.round(a.duration_min) + 'min' : ''}`.trim()
      ).join('\n')

      const context = [
        `Athlete: ${user.name || 'Athlete'}, ${user.current_level || 'recreational'} level`,
        user.health_notes ? `Health: ${user.health_notes}` : null,
        primarySport ? `Primary goal: ${primarySport.current_goal_raw || primarySport.sport_raw} (${primarySport.lifecycle_state})` : null,
        daysToTarget ? `Days to target event: ${daysToTarget}` : null,
        activities?.length ? `\nRecent training:\n${activityLines}` : 'No recent Strava data.',
      ].filter(Boolean).join('\n')

      const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 600,
          system: `You are Coach Claude, an elite performance coach. Generate a concise daily briefing. Format as 4-5 bullet points — direct, data-driven, specific. Reference actual numbers. Today is ${today}. No markdown headers or bold text. Each point on its own line starting with •.`,
          messages: [{
            role: 'user',
            content: `Generate today's coaching briefing.\n\n${context}`,
          }],
        }),
      })

      const claudeData = await resp.json()
      const briefingText = claudeData.content?.[0]?.text
      if (!briefingText) continue

      await supabase.from('daily_briefings').insert({
        user_id: user.user_id,
        date: todayStr,
        briefing_text: briefingText,
      })

      generated++
    }

    return new Response(
      JSON.stringify({ generated, date: todayStr }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
