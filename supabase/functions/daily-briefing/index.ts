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
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      const sevenDaysAgoIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
      const [
        { data: activities },
        { data: sports },
        { data: recentSessions },
        { data: recentCues },
      ] = await Promise.all([
        supabase
          .from('activities')
          .select('date, name, type, distance_km, elevation_m, avg_hr, duration_min, pace_per_km')
          .eq('user_id', user.user_id)
          .eq('is_deleted', false)
          .order('date', { ascending: false })
          .limit(7),
        supabase
          .from('athlete_sports')
          .select('sport_raw, sport_category, priority, current_goal_raw, target_date, lifecycle_state')
          .eq('user_id', user.user_id)
          .eq('is_active', true),
        supabase
          .from('scheduled_sessions')
          .select('name, planned_date, session_type, status')
          .eq('user_id', user.user_id)
          .gte('planned_date', sevenDaysAgo)
          .lt('planned_date', todayStr)
          .order('planned_date', { ascending: false })
          .limit(14),
        // AC-134: last 7 days of coaching cues so the model can avoid
        // restating an observation it already made.
        supabase
          .from('coaching_memory')
          .select('content, category, created_at, meta')
          .eq('user_id', user.user_id)
          .eq('category', 'cue')
          .gte('created_at', sevenDaysAgoIso)
          .order('created_at', { ascending: false })
          .limit(15),
      ])

      // Build context string
      const primarySport = sports?.find(s => s.priority === 'primary') || sports?.[0]
      const targetDate = primarySport?.target_date
      const daysToTarget = targetDate
        ? Math.ceil((new Date(targetDate).getTime() - Date.now()) / 86400000)
        : null

      // AC-141: emit day-delta so the model uses accurate relative language
      // ("Saturday's run", "today's session") instead of defaulting to
      // "yesterday" for anything older than today.
      // AC-152: also emit hours-since-completion so the model can frame
      // a same-day already-completed activity as "this morning's" or
      // "today's already-completed", not "yesterday's".
      const msPerDay = 86400000
      const activityLines = (activities || []).map(a => {
        const d = new Date(a.date)
        const daysSince = Math.round((Date.now() - d.getTime()) / msPerDay)
        const weekday = d.toLocaleDateString('en-GB', { weekday: 'long' })
        const shortDate = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
        // Hours since the activity finished. Approximated as
        // (now - start) − duration; floors at 0 for in-progress edges.
        const hoursSinceEndRaw = ((Date.now() - d.getTime()) / 3600000) -
          ((a.duration_min ?? 0) / 60)
        const hoursSinceEnd = Math.max(0, Math.round(hoursSinceEndRaw))
        return `- ${shortDate} (${weekday}, ${daysSince} day${daysSince === 1 ? '' : 's'} ago, ${hoursSinceEnd}h ago): ${a.name} ${a.distance_km ? a.distance_km + 'km' : ''} ${a.avg_hr ? 'HR ' + Math.round(a.avg_hr) : ''} ${a.duration_min ? Math.round(a.duration_min) + 'min' : ''}`.trim()
      }).join('\n')

      // Build last-7-days session summary
      const sessionSummary = (() => {
        if (!recentSessions?.length) return null
        const completed = recentSessions.filter(s => s.status === 'completed')
        const missed = recentSessions.filter(s => s.status === 'missed')
        const unresolved = recentSessions.filter(s => s.status === 'planned' || !s.status)
        const lines = [`Last 7 days: ${recentSessions.length} planned, ${completed.length} completed, ${missed.length} missed, ${unresolved.length} unresolved`]
        missed.forEach(s => lines.push(`  ⚠ MISSED: ${s.planned_date} — ${s.name}`))
        completed.forEach(s => lines.push(`  ✓ DONE: ${s.planned_date} — ${s.name}`))
        return lines.join('\n')
      })()

      // AC-134: format recent cues so the model knows what it already
      // raised. One line per cue, oldest first within the 7-day window
      // (the LIMIT above returns newest-first; we reverse here).
      const cueLines = (recentCues || []).slice().reverse().map(c => {
        const topic = (c.meta as any)?.topic ?? 'unspecified'
        const when = new Date(c.created_at).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
        return `- [${topic}] ${when}: ${c.content}`
      }).join('\n')

      const context = [
        `Athlete: ${user.name || 'Athlete'}, ${user.current_level || 'recreational'} level`,
        user.health_notes ? `Health: ${user.health_notes}` : null,
        primarySport ? `Primary goal: ${primarySport.current_goal_raw || primarySport.sport_raw} (${primarySport.lifecycle_state})` : null,
        daysToTarget ? `Days to target event: ${daysToTarget}` : null,
        sessionSummary,
        activities?.length ? `\nRecent Strava activities:\n${activityLines}` : 'No recent Strava data.',
        recentCues?.length ? `\nCues already raised in the last 7 days (do NOT restate verbatim):\n${cueLines}` : null,
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
          system: `You are Coach Claude, an elite performance coach. Generate a concise daily briefing. Format as 4-5 bullet points — direct, data-driven, specific. Reference actual numbers. Today is ${today}. No markdown headers or bold text. Each point on its own line starting with •. You have access to last week's session history showing planned vs completed vs missed sessions. Always base your weekly review on ACTUAL completions, not planned sessions. If sessions were missed, call this out directly — do not pretend they were done.

Relative date language: each activity line includes "(N days ago, Xh ago)". Use this exactly:
  • 0 days ago AND completed before now (Xh ago > 0) → "this morning's", "today's already-completed", or "today's run/ride/session" — this is REAL data; do NOT call it "yesterday's"
  • 0 days ago AND not yet completed (planned/upcoming) → "today's planned" or upcoming framing
  • 1 day ago → "yesterday's"
  • 2–6 days ago → "{weekday}'s" (e.g. "Saturday's long run")
  • 7+ days ago → "last {weekday}'s" or the explicit date
NEVER say "yesterday" for activities with 0 days ago.
NEVER bundle today's done-session with yesterday's session under "yesterday" — they are separate days. If multiple activities span multiple days, refer to each by its own correct day. Do not group "yesterday's run + today's ride" under one umbrella term.

Coaching voice (do not violate):
1. ONE cue per topic, never repeated. The "Cues already raised" list above shows what you said this week. Do NOT restate any of those critiques in similar framing. If the underlying trend has meaningfully worsened, you may escalate (ask a question, propose a specific fix). Otherwise step back.
2. AGENCY-OFFERING language. Prefer "What if you…" over "You should…". Prefer "Tomorrow could be a rest day if…" over "Skip tomorrow." The athlete owns the plan; you are an advisor.
3. NEVER nag about missed sessions. Acknowledge once if relevant; do not relitigate across briefings. The user already knows.
4. NO motivational fluff, NO restating the obvious, NO lecturing on generic principles. Each bullet must contain specific data or a specific question.`,
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
