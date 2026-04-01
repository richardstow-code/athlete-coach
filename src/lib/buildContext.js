import { supabase } from './supabase'
import { inferCyclePhase, daysSincePeriod } from './inferCyclePhase'
import { classifyElevation, ELEVATION_TARGETS, elevationTargetRange } from './elevationUtils'
import { resolveZones, zonesPromptString } from './hrZones'

/**
 * Fetches all context needed for coaching prompts in a single parallel round-trip.
 * All table queries are automatically scoped to the authenticated user via RLS
 * (user_id = auth.uid()), including athlete_settings.
 */
const TZ = 'Europe/Vienna'

export async function buildContext() {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: TZ })
  const in7Days = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toLocaleDateString('en-CA', { timeZone: TZ })
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toLocaleDateString('en-CA', { timeZone: TZ })

  const [
    { data: activities },
    { data: upcomingSessions },
    { data: recentSessions },
    { data: nutrition },
    { data: memory },
    { data: briefings },
    { data: settings },
    { data: cycleLogs },
    { data: sportsData },
    { data: injuryReports },
    { data: healthSnapshot },
  ] = await Promise.all([
    supabase
      .from('activities')
      .select('name,date,type,distance_km,duration_min,avg_hr,max_hr,elevation_m,pace_per_km,zone_data,raw_data,enrichment_status')
      .order('date', { ascending: false })
      .limit(10),

    supabase
      .from('scheduled_sessions')
      .select('name,planned_date,session_type,zone,intensity,duration_min_low,duration_min_high,notes,elevation_target_m,status')
      .gte('planned_date', today)
      .lte('planned_date', in7Days)
      .order('planned_date')
      .limit(7),

    supabase
      .from('scheduled_sessions')
      .select('name,planned_date,session_type,zone,duration_min_low,duration_min_high,status,notes')
      .gte('planned_date', sevenDaysAgo)
      .lt('planned_date', today)
      .order('planned_date', { ascending: false })
      .limit(14),

    supabase
      .from('nutrition_logs')
      .select('calories,protein_g,carbs_g,fat_g,meal_type,alcohol_units,meal_name')
      .eq('date', today),

    supabase
      .from('coaching_memory')
      .select('content,created_at,category')
      .order('created_at', { ascending: false })
      .limit(5),

    supabase
      .from('daily_briefings')
      .select('briefing_text,date')
      .order('date', { ascending: false })
      .limit(1),

    supabase
      .from('athlete_settings')
      .select('name,dob,height_cm,weight_kg,races,goal_type,current_level,health_notes,cycle_tracking_enabled,cycle_length_avg,cycle_is_irregular,cycle_last_period_date,cycle_notes,health_flags,training_zones,hr_zones')
      .maybeSingle(),

    supabase
      .from('cycle_logs')
      .select('phase_reported, override_intensity, notes, log_date')
      .order('log_date', { ascending: false })
      .limit(5),

    supabase
      .from('athlete_sports')
      .select('*')
      .eq('is_active', true)
      .order('created_at'),

    supabase
      .from('injury_reports')
      .select('body_location,severity,athlete_notes,claude_assessment,follow_up_due_date,status,reported_at')
      .in('status', ['active', 'monitoring'])
      .order('reported_at', { ascending: false })
      .limit(5),

    supabase
      .from('health_snapshots')
      .select('resting_hr,hrv_ms,sleep_hours,sleep_quality,date')
      .order('date', { ascending: false })
      .limit(3),
  ])

  // Cycle context — only populated if user has opted in
  let cycleContext = null
  if (settings?.cycle_tracking_enabled) {
    const phase = inferCyclePhase(
      settings.cycle_last_period_date,
      settings.cycle_length_avg,
      settings.cycle_is_irregular || false,
      cycleLogs || []
    )
    const daysSince = daysSincePeriod(settings.cycle_last_period_date)
    const today = new Date().toLocaleDateString('en-CA', { timeZone: TZ })
    const todayLog = cycleLogs?.find(l => l.log_date === today) || null
    cycleContext = {
      tracking_enabled: true,
      estimated_phase:  phase,
      is_irregular:     settings.cycle_is_irregular || false,
      days_since_period: daysSince,
      recent_log:       todayLog,
    }
  }

  const primarySport   = sportsData?.find(s => s.priority === 'primary') || sportsData?.[0] || null
  const supportingSports = sportsData?.filter(s => s.priority === 'supporting' || s.priority === 'recovery') || []

  return {
    activities:       activities       || [],
    upcomingSessions: upcomingSessions || [],
    recentSessions:   recentSessions   || [],
    nutrition:        nutrition        || [],
    memory:           memory           || [],
    briefing:         briefings?.[0]   || null,
    settings:         settings         || null,
    cycle_context:    cycleContext,
    primary_sport:    primarySport,
    supporting_sports: supportingSports,
    all_sports:       sportsData        || [],
    injury_reports:   injuryReports    || [],
    health_snapshots: healthSnapshot   || [],
  }
}

/**
 * Formats a buildContext() result into a compact text block for injection
 * into Claude system or user prompts.
 */
export function formatContext({
  activities = [],
  upcomingSessions = [],
  recentSessions = [],
  nutrition = [],
  memory = [],
  briefing = null,
  settings = null,
  cycle_context = null,
  primary_sport = null,
  supporting_sports = [],
  all_sports = [],
  injury_reports = [],
  health_snapshots = [],
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
    if (settings.current_level) lines.push(`Level: ${settings.current_level}`)
    const upcoming = (settings.races || [])
      .filter(r => r.date >= new Date().toLocaleDateString('en-CA', { timeZone: TZ }))
      .sort((a, b) => a.date.localeCompare(b.date))
    if (upcoming.length > 0) {
      const next = upcoming[0]
      const daysTo = Math.ceil((new Date(next.date) - new Date()) / (24 * 60 * 60 * 1000))
      const elevM = parseFloat(next.elevation_m || next.elevation) || 0
      const distKm = parseFloat(next.distance) || null
      const classification = classifyElevation(elevM, distKm)
      const elevNote = elevM > 0 ? ` | ↑ ${elevM}m (${classification})` : ''
      lines.push(`Next race: ${next.name} on ${next.date} (${daysTo}d)${distKm ? ` — ${distKm}km` : ''} | target ${next.target}${elevNote}`)
    }
    if (settings.health_notes) lines.push(`Health: ${settings.health_notes}`)
    if (lines.length > 0) parts.push('ATHLETE:\n' + lines.map(l => `- ${l}`).join('\n'))

    // HR zones — injected so coaching AI uses current calibrated values
    const effectiveZones = resolveZones(settings)
    const zoneStr = zonesPromptString(effectiveZones)
    const zoneSource = effectiveZones.source === 'tt_5km' ? 'calibrated from 5km TT'
      : effectiveZones.source === 'auto_detected' ? 'auto-detected from training data'
      : effectiveZones.source === 'manual' ? 'manually configured'
      : 'default'
    parts.push(`HR ZONES (${zoneSource}): ${zoneStr}`)

    // Health flags from structured health_flags column (overrides health_notes when present)
    const activeFlags = (settings.health_flags || []).filter(f => f.status === 'active' || f.status === 'monitoring')
    if (activeFlags.length > 0) {
      const flagLines = activeFlags.map(f => `- ${f.label} (${f.status}): ${f.notes}`)
      parts.push('ACTIVE HEALTH FLAGS:\n' + flagLines.join('\n'))
    }
  }

  // ── Weekly elevation tracking (for endurance sports) ─────
  if (settings && activities.length > 0) {
    const upcoming = (settings.races || [])
      .filter(r => r.date >= new Date().toLocaleDateString('en-CA', { timeZone: TZ }))
      .sort((a, b) => a.date.localeCompare(b.date))
    const nextRace = upcoming[0] || null
    if (nextRace) {
      const elevM = parseFloat(nextRace.elevation_m || nextRace.elevation) || 0
      const distKm = parseFloat(nextRace.distance) || null
      const classification = classifyElevation(elevM, distKm)
      // Only add elevation tracking for non-flat races or if user regularly gets elevation
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toLocaleDateString('en-CA', { timeZone: TZ })
      const weekActivities = activities.filter(a => (a.date || '').slice(0, 10) >= weekAgo)
      const weekElevTotal = Math.round(weekActivities.reduce((s, a) => s + parseFloat(a.elevation_m || 0), 0))
      const targets = ELEVATION_TARGETS[classification]
      if (weekElevTotal > 0 || classification !== 'flat') {
        const targetStr = elevationTargetRange(classification, 'base')
        const [tLow, tHigh] = targets.base
        const status = weekElevTotal >= tLow && weekElevTotal <= tHigh * 1.3
          ? '✓ on track'
          : weekElevTotal < tLow
            ? '⚠ below target'
            : '↑ above target (check recovery)'
        parts.push(
          `ELEVATION TRACKING:\n` +
          `- Race course: ${classification} (${elevM > 0 ? elevM + 'm total gain' : 'unknown elevation'})\n` +
          `- Weekly elevation target (current phase): ${targetStr}\n` +
          `- This week so far: ${weekElevTotal}m — ${status}`
        )
      }
    }
  }

  // ── Active injury reports ─────────────────────────────────
  if (injury_reports.length > 0) {
    const injuryLines = injury_reports.map(r => {
      let assessment = null
      try { assessment = typeof r.claude_assessment === 'string' ? JSON.parse(r.claude_assessment) : r.claude_assessment } catch {}
      const date = r.reported_at?.slice(0, 10) || '?'
      const coachMsg = assessment?.coachMessage ? ` — ${assessment.coachMessage}` : r.athlete_notes ? ` — "${r.athlete_notes}"` : ''
      return `- ${r.body_location || 'Unspecified location'} (${r.severity || 'unknown severity'}, ${r.status}, reported ${date})${coachMsg}`
    })
    parts.push('ACTIVE INJURY REPORTS:\n' + injuryLines.join('\n'))
  }

  // ── Sports context ────────────────────────────────────────
  if (all_sports.length > 0) {
    const sportLines = []
    if (primary_sport) {
      const ps = primary_sport
      let primaryLine = `Primary: ${ps.sport_raw}`
      if (ps.sport_category) primaryLine += ` (${ps.sport_category})`
      if (ps.lifecycle_state) primaryLine += ` — ${ps.lifecycle_state.replace(/_/g, ' ')} phase`
      if (ps.target_metric)   primaryLine += `, target: ${ps.target_metric}`
      if (ps.target_date) {
        const daysTo = Math.ceil((new Date(ps.target_date) - new Date()) / (24 * 60 * 60 * 1000))
        primaryLine += `, race date: ${ps.target_date} (${daysTo}d)`
      }
      sportLines.push(primaryLine)
    }
    const supporting = all_sports.filter(s => s.priority === 'supporting')
    if (supporting.length > 0) {
      sportLines.push(`Supporting: ${supporting.map(s => s.sport_raw + (s.sport_category ? ` (${s.sport_category})` : '')).join(', ')}`)
    }
    const recovery = all_sports.filter(s => s.priority === 'recovery')
    if (recovery.length > 0) {
      sportLines.push(`Recovery: ${recovery.map(s => s.sport_raw).join(', ')}`)
    }
    if (sportLines.length > 0) parts.push('SPORTS CONTEXT:\n' + sportLines.map(l => `- ${l}`).join('\n'))
  }

  // ── Recent activities ────────────────────────────────────
  if (activities.length > 0) {
    // Use local-time dates so relative labels are correct for the user's timezone
    const todayLocal = new Date().toLocaleDateString('en-CA', { timeZone: TZ })
    const yesterdayLocal = new Date(Date.now() - 86400000).toLocaleDateString('en-CA', { timeZone: TZ })
    parts.push(
      'RECENT ACTIVITIES:\n' +
      activities.map(a => {
        const actDate = a.date?.slice(0, 10)
        const relLabel = actDate === todayLocal ? 'today'
          : actDate === yesterdayLocal ? 'yesterday'
          : actDate || '?'
        const bits = [
          relLabel,
          a.type,
          a.distance_km ? `${a.distance_km}km` : null,
          a.duration_min ? `${Math.round(a.duration_min)}min` : null,
          a.avg_hr ? `HR ${Math.round(a.avg_hr)}avg` : null,
          a.max_hr ? `/${Math.round(a.max_hr)}max` : null,
          a.elevation_m ? `↑${Math.round(a.elevation_m)}m` : null,
          a.pace_per_km ? `${a.pace_per_km}/km` : null,
        ].filter(Boolean).join(', ')

        // Add per-km splits if available in raw_data
        let splitsLine = ''
        if (a.raw_data?.splits_metric && a.raw_data.splits_metric.length > 0) {
          const splits = a.raw_data.splits_metric
            .filter(s => s.distance > 100 && s.moving_time > 0)
            .map((s, i) => {
              const secPerKm = s.moving_time / (s.distance / 1000)
              const mins = Math.floor(secPerKm / 60)
              const secs = Math.round(secPerKm % 60)
              const hrNote = s.average_heartrate ? ` @${Math.round(s.average_heartrate)}bpm` : ''
              return `km${i + 1}: ${mins}:${String(secs).padStart(2, '0')}${hrNote}`
            })
            .join(' | ')
          if (splits) splitsLine = `\n  Splits: ${splits}`
        }

        return `- ${a.name}: ${bits}${splitsLine}`
      }).join('\n')
    )
  }

  // ── Last 7 days: planned vs actual ───────────────────────
  if (recentSessions.length > 0) {
    const completed = recentSessions.filter(s => s.status === 'completed')
    const missed    = recentSessions.filter(s => s.status === 'missed')
    const pending   = recentSessions.filter(s => s.status === 'planned' || !s.status)

    const lines = []
    lines.push(`Total planned: ${recentSessions.length} | Completed: ${completed.length} | Missed: ${missed.length} | Unresolved: ${pending.length}`)

    if (missed.length > 0) {
      missed.forEach(s => {
        lines.push(`⚠ MISSED: ${s.planned_date} — ${s.name} (${s.session_type || 'session'})`)
      })
    }
    if (completed.length > 0) {
      completed.forEach(s => {
        lines.push(`✓ DONE: ${s.planned_date} — ${s.name}`)
      })
    }
    if (pending.length > 0) {
      pending.forEach(s => {
        lines.push(`? UNRESOLVED: ${s.planned_date} — ${s.name}`)
      })
    }

    parts.push('LAST 7 DAYS — PLANNED vs ACTUAL:\n' + lines.map(l => `- ${l}`).join('\n'))
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
      memory.map(m => {
        const label = m.category === 'activity_feedback' ? '[Run feedback]'
          : m.category === 'baseline' ? '[Baseline analysis]'
          : '[Chat]'
        const date = m.created_at?.slice(0, 10) || ''
        return `${label} ${date}:\n${m.content}`
      }).join('\n---\n')
    )
  }

  // ── Native health data (HealthKit) ───────────────────────────
  if (health_snapshots.length > 0) {
    const latest = health_snapshots[0]
    const lines = [`Date: ${latest.date}`]
    if (latest.resting_hr) lines.push(`Resting HR: ${latest.resting_hr} bpm`)
    if (latest.hrv_ms)     lines.push(`HRV: ${latest.hrv_ms} ms`)
    if (latest.sleep_hours) {
      const qualityNote = latest.sleep_quality ? ` (${latest.sleep_quality})` : ''
      lines.push(`Sleep: ${latest.sleep_hours}h${qualityNote}`)
    }
    if (lines.length > 1) parts.push('RECOVERY METRICS (from Apple Health):\n' + lines.map(l => `- ${l}`).join('\n'))
  }

  // ── Cycle context ─────────────────────────────────────────────
  if (cycle_context?.tracking_enabled) {
    const { estimated_phase, is_irregular, days_since_period, recent_log } = cycle_context
    const lines = []

    const PHASE_LABELS = {
      menstrual: 'Menstrual', follicular: 'Follicular',
      ovulatory: 'Ovulatory', luteal: 'Luteal',
    }

    if (estimated_phase !== 'unknown' && PHASE_LABELS[estimated_phase]) {
      const dayNote = days_since_period != null ? ` (day ${days_since_period + 1} of cycle)` : ''
      const irregNote = is_irregular ? ' — irregular cycle, estimate only' : ''
      lines.push(`Estimated phase: ${PHASE_LABELS[estimated_phase]}${dayNote}${irregNote}`)
    } else {
      lines.push('Cycle phase: unknown — rely on user signals only')
    }

    if (recent_log?.phase_reported) {
      lines.push(`User reported today: ${recent_log.phase_reported.replace(/_/g, ' ')}`)
    }
    if (recent_log?.override_intensity) {
      lines.push(`Intensity preference today: ${recent_log.override_intensity} — respect this without requiring explanation`)
    }
    if (recent_log?.notes) {
      lines.push(`User note: ${recent_log.notes}`)
    }

    const GUIDANCE = {
      menstrual:  'Coaching: Acknowledge potential lower energy. Proactively offer lighter session options. Prioritise rest if fatigue is signalled. Never assume — always check in first.',
      follicular: 'Coaching: Energy typically building. A good time to introduce new challenges or increase load if the athlete feels ready — check in before assuming.',
      ovulatory:  'Coaching: Often peak energy. Can support higher intensity if the athlete is up for it. Always follow their lead.',
      luteal:     'Coaching: Energy may reduce toward end of phase; PMS symptoms possible. Be especially attuned to mood and fatigue. Avoid pushing load increases.',
      unknown:    'Coaching: Phase unknown — check in regularly about energy and readiness rather than making any assumptions.',
    }
    const guidance = GUIDANCE[estimated_phase] || GUIDANCE.unknown
    lines.push(guidance)

    if (lines.length > 0) {
      parts.push('CYCLE CONTEXT:\n' + lines.map(l => `- ${l}`).join('\n'))
    }
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
