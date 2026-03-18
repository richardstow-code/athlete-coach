import { supabase } from './supabase'

/**
 * Fetches all context needed for coaching prompts in a single parallel round-trip.
 * All table queries are automatically scoped to the authenticated user via RLS
 * (user_id = auth.uid()), including athlete_settings.
 */
export async function buildContext() {
  const today = new Date().toISOString().slice(0, 10)
  const in7Days = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  const [
    { data: activities },
    { data: upcomingSessions },
    { data: nutrition },
    { data: memory },
    { data: briefings },
    { data: settings },
  ] = await Promise.all([
    supabase
      .from('activities')
      .select('name,date,type,distance_km,duration_min,avg_hr,max_hr,elevation_m,pace_per_km,zone_data')
      .order('date', { ascending: false })
      .limit(5),

    supabase
      .from('scheduled_sessions')
      .select('name,planned_date,session_type,zone,intensity,duration_min_low,duration_min_high,notes,elevation_target_m,status')
      .gte('planned_date', today)
      .lte('planned_date', in7Days)
      .order('planned_date')
      .limit(7),

    supabase
      .from('nutrition_logs')
      .select('calories,protein_g,carbs_g,fat_g,meal_type,alcohol_units,meal_name')
      .eq('date', today),

    supabase
      .from('coaching_memory')
      .select('content,created_at,category')
      .order('created_at', { ascending: false })
      .limit(3),

    supabase
      .from('daily_briefings')
      .select('briefing_text,date')
      .order('date', { ascending: false })
      .limit(1),

    supabase
      .from('athlete_settings')
      .select('name,dob,height_cm,weight_kg,races')
      .maybeSingle(),
  ])

  return {
    activities:       activities       || [],
    upcomingSessions: upcomingSessions || [],
    nutrition:        nutrition        || [],
    memory:           memory           || [],
    briefing:         briefings?.[0]   || null,
    settings:         settings         || null,
  }
}

/**
 * Formats a buildContext() result into a compact text block for injection
 * into Claude system or user prompts.
 */
export function formatContext({
  activities = [],
  upcomingSessions = [],
  nutrition = [],
  memory = [],
  briefing = null,
  settings = null,
} = {}) {
  const parts = []

  // ── Athlete snapshot ─────────────────────────────────────
  if (settings) {
    const lines = []
    if (settings.name)       lines.push(`Name: ${settings.name}`)
    if (settings.weight_kg)  lines.push(`Weight: ${settings.weight_kg}kg`)
    if (settings.height_cm)  lines.push(`Height: ${settings.height_cm}cm`)
    if (settings.dob) {
      const age = Math.floor((Date.now() - new Date(settings.dob)) / (365.25 * 24 * 60 * 60 * 1000))
      lines.push(`Age: ${age}`)
    }
    const upcoming = (settings.races || [])
      .filter(r => r.date >= new Date().toISOString().slice(0, 10))
      .sort((a, b) => a.date.localeCompare(b.date))
    if (upcoming.length > 0) {
      const next = upcoming[0]
      const daysTo = Math.ceil((new Date(next.date) - new Date()) / (24 * 60 * 60 * 1000))
      lines.push(`Next race: ${next.name} on ${next.date} (${daysTo}d) — target ${next.target}`)
    }
    if (lines.length > 0) parts.push('ATHLETE:\n' + lines.map(l => `- ${l}`).join('\n'))
  }

  // ── Recent activities ────────────────────────────────────
  if (activities.length > 0) {
    parts.push(
      'RECENT ACTIVITIES:\n' +
      activities.map(a => {
        const bits = [
          a.date?.slice(0, 10),
          a.type,
          a.distance_km ? `${a.distance_km}km` : null,
          a.duration_min ? `${Math.round(a.duration_min)}min` : null,
          a.avg_hr ? `HR ${Math.round(a.avg_hr)}avg` : null,
          a.max_hr ? `/${Math.round(a.max_hr)}max` : null,
          a.elevation_m ? `↑${Math.round(a.elevation_m)}m` : null,
          a.pace_per_km ? `${a.pace_per_km}/km` : null,
        ].filter(Boolean).join(', ')
        return `- ${a.name}: ${bits}`
      }).join('\n')
    )
  }

  // ── Upcoming sessions ────────────────────────────────────
  if (upcomingSessions.length > 0) {
    parts.push(
      'UPCOMING SESSIONS:\n' +
      upcomingSessions.map(s => {
        const day = new Date(s.planned_date + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short' })
        const dur = s.duration_min_low ? ` ${s.duration_min_low}-${s.duration_min_high}min` : ''
        const zone = s.zone ? ` — ${s.zone}` : ''
        const elev = s.elevation_target_m > 0 ? ` ↑${s.elevation_target_m}m` : ''
        const done = s.status === 'completed' ? ' ✓' : ''
        return `- ${s.planned_date} (${day}): ${s.name}${zone}${dur}${elev}${done}`
      }).join('\n')
    )
  }

  // ── Today's nutrition ────────────────────────────────────
  if (nutrition.length > 0) {
    const food    = nutrition.filter(n => n.meal_type !== 'alcohol')
    const alcohol = nutrition.filter(n => n.meal_type === 'alcohol')
    const kcal    = food.reduce((s, n) => s + (n.calories || 0), 0)
    const protein = Math.round(food.reduce((s, n) => s + parseFloat(n.protein_g || 0), 0))
    const carbs   = Math.round(food.reduce((s, n) => s + parseFloat(n.carbs_g || 0), 0))
    const fat     = Math.round(food.reduce((s, n) => s + parseFloat(n.fat_g || 0), 0))
    const units   = alcohol.reduce((s, n) => s + parseFloat(n.alcohol_units || 0), 0)

    const nutLines = []
    if (kcal > 0 || protein > 0) {
      nutLines.push(`${kcal}kcal, ${protein}g protein, ${carbs}g carbs, ${fat}g fat (targets: 2800kcal / 150g protein)`)
    }
    if (units > 0) nutLines.push(`Alcohol: ${units.toFixed(1)} units today`)
    if (food.length > 0) nutLines.push(`Meals: ${food.map(n => n.meal_name).filter(Boolean).join(', ')}`)

    if (nutLines.length > 0) parts.push("TODAY'S NUTRITION:\n" + nutLines.map(l => `- ${l}`).join('\n'))
  }

  // ── Recent coaching memory ───────────────────────────────
  if (memory.length > 0) {
    parts.push(
      'RECENT COACHING EXCHANGES:\n' +
      memory.map(m => m.content).join('\n---\n')
    )
  }

  // ── Latest briefing ──────────────────────────────────────
  if (briefing) {
    const snippet = briefing.briefing_text
      ?.split('\n')
      .filter(l => l.trim().startsWith('→'))
      .slice(0, 3)
      .join(' ')
      .slice(0, 300)
    if (snippet) parts.push(`LATEST BRIEFING (${briefing.date}):\n${snippet}`)
  }

  return parts.join('\n\n')
}
