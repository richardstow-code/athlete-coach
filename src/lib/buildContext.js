import { supabase } from './supabase'

export async function buildContext() {
  const today = new Date().toISOString().slice(0, 10)
  const [
    { data: activities },
    { data: upcomingSessions },
    { data: nutrition },
    { data: memory },
    { data: briefings },
  ] = await Promise.all([
    supabase.from('activities').select('*').order('date', { ascending: false }).limit(5),
    supabase.from('scheduled_sessions').select('*').gte('planned_date', today).order('planned_date').limit(7),
    supabase.from('nutrition_logs').select('calories,protein_g,meal_type').eq('date', today),
    supabase.from('coaching_memory').select('content,created_at').eq('category', 'chat').order('created_at', { ascending: false }).limit(3),
    supabase.from('daily_briefings').select('briefing_text,date').order('created_at', { ascending: false }).limit(1),
  ])

  return {
    activities:       activities       || [],
    upcomingSessions: upcomingSessions || [],
    nutrition:        nutrition        || [],
    memory:           memory           || [],
    briefing:         briefings?.[0]   || null,
  }
}

export function formatContext({ activities = [], upcomingSessions = [], nutrition = [], memory = [], briefing = null } = {}) {
  const parts = []

  if (activities.length > 0) {
    parts.push(
      'RECENT ACTIVITIES:\n' +
      activities.map(a =>
        `- ${a.name} (${a.date?.slice(0, 10)}): ${a.distance_km}km, ${a.duration_min}min, HR avg ${a.avg_hr}, elev ${a.elevation_m}m, type: ${a.type}`
      ).join('\n')
    )
  }

  if (upcomingSessions.length > 0) {
    parts.push(
      'UPCOMING SESSIONS:\n' +
      upcomingSessions.map(s => {
        const day = new Date(s.planned_date + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short' })
        const dur = s.duration_min_low ? ` ${s.duration_min_low}-${s.duration_min_high}min` : ''
        return `- ${s.planned_date} (${day}): ${s.name}${s.zone ? ` — ${s.zone}` : ''}${dur}`
      }).join('\n')
    )
  }

  if (nutrition.length > 0) {
    const food = nutrition.filter(n => n.meal_type !== 'alcohol')
    const kcal    = food.reduce((s, n) => s + (n.calories || 0), 0)
    const protein = Math.round(food.reduce((s, n) => s + parseFloat(n.protein_g || 0), 0))
    if (kcal > 0 || protein > 0) {
      parts.push(`TODAY'S NUTRITION: ${kcal}kcal logged, ${protein}g protein (targets: 2800kcal, 150g protein)`)
    }
  }

  if (memory.length > 0) {
    parts.push(
      'RECENT COACHING EXCHANGES:\n' +
      memory.map(m => m.content).join('\n---\n')
    )
  }

  if (briefing) {
    const snippet = briefing.briefing_text?.split('\n').filter(l => l.trim()).slice(0, 3).join(' ').slice(0, 200)
    if (snippet) parts.push(`LATEST BRIEFING (${briefing.date}): ${snippet}`)
  }

  return parts.join('\n\n')
}
