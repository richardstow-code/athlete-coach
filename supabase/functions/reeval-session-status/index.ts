/**
 * reeval-session-status
 * One-shot edge function that re-evaluates status for all past sessions
 * that are still showing 'planned' or 'missed'.
 * AC-095
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Session status logic (mirrors lib/sessionStatus.ts)
function activityMatchesSessionType(activityType: string, sessionType: string): boolean {
  const a = activityType.toLowerCase()
  const s = sessionType.toLowerCase()
  if (a === s) return true
  if (s === 'run' && (a === 'run' || a === 'running' || a === 'trailrun' || a.includes('run'))) return true
  if (s === 'trailrun' && (a === 'trailrun' || a.includes('trail'))) return true
  if (s === 'strength' && (a === 'workout' || a === 'weighttraining' || a === 'strength')) return true
  if (s === 'cycling' && (a === 'ride' || a === 'virtualride' || a.includes('ride'))) return true
  if (s === 'swim' && (a === 'swim' || a === 'openwaterswim' || a.includes('swim'))) return true
  return false
}

function evaluateSessionStatus(
  session: { id: string; planned_date: string; session_type: string; status: string },
  activitiesOnDate: Array<{ id: number; type: string; name: string | null; duration_min: number | null; created_at: string }>,
  todayVienna: string
): { status: string; completed_at: string | null } {
  if (session.planned_date >= todayVienna) return { status: 'planned', completed_at: null }
  if (session.session_type === 'rest') return { status: 'rest_observed', completed_at: null }
  if (activitiesOnDate.length === 0) return { status: 'missed', completed_at: null }

  const matched = activitiesOnDate.find(a => activityMatchesSessionType(a.type, session.session_type))
  if (matched) return { status: 'completed', completed_at: matched.created_at }

  return { status: 'completed_different', completed_at: activitiesOnDate[0].created_at }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    const todayVienna = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Vienna' })

    // Fetch all past sessions still showing planned or missed
    const { data: sessions, error: sessErr } = await supabase
      .from('scheduled_sessions')
      .select('id, user_id, planned_date, session_type, status')
      .lt('planned_date', todayVienna)
      .in('status', ['planned', 'missed'])
      .limit(500)

    if (sessErr) {
      return new Response(JSON.stringify({ error: sessErr.message }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      })
    }

    if (!sessions?.length) {
      return new Response(JSON.stringify({ updated: 0, message: 'No sessions to re-evaluate' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Group sessions by user_id + date for efficient activity lookups
    const dateUserPairs = new Map<string, Set<string>>()
    for (const s of sessions) {
      const key = `${s.user_id}:${s.planned_date}`
      if (!dateUserPairs.has(key)) dateUserPairs.set(key, new Set())
      dateUserPairs.get(key)!.add(s.id)
    }

    // Cache activities per user+date
    const activityCache = new Map<string, any[]>()

    async function getActivitiesForDate(userId: string, date: string): Promise<any[]> {
      const key = `${userId}:${date}`
      if (activityCache.has(key)) return activityCache.get(key)!
      const { data } = await supabase
        .from('activities')
        .select('id, type, name, duration_min, created_at')
        .eq('user_id', userId)
        .neq('is_deleted', true)
        .gte('date', date + 'T00:00:00Z')
        .lte('date', date + 'T23:59:59Z')
      const result = data ?? []
      activityCache.set(key, result)
      return result
    }

    let updated = 0

    for (const session of sessions) {
      const activities = await getActivitiesForDate(session.user_id, session.planned_date)
      const result = evaluateSessionStatus(session, activities, todayVienna)

      if (result.status !== session.status) {
        const updatePayload: Record<string, any> = { status: result.status }
        if (result.completed_at) updatePayload.completed_at = result.completed_at
        await supabase.from('scheduled_sessions').update(updatePayload).eq('id', session.id)
        updated++
      }
    }

    console.log(`[reeval-session-status] Updated ${updated}/${sessions.length} sessions`)

    return new Response(JSON.stringify({ updated, total: sessions.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})
