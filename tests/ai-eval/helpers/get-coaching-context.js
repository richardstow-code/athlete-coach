/**
 * Fetches and formats coaching context for a given user_id from the test
 * Supabase project. Mirrors the logic of src/lib/buildContext.js +
 * formatContext() but runs in Node with the service-role client.
 *
 * Also builds the dynamic system prompt mirroring coachingPrompt.js.
 */

import { testDb } from '../../helpers/supabase-test-client.js'

const TZ = 'Europe/Vienna'

// ── Cycle phase inference (mirrors inferCyclePhase.js) ────────────────────────
function daysSincePeriod(lastPeriodDate) {
  if (!lastPeriodDate) return null
  const days = Math.floor((new Date() - new Date(lastPeriodDate)) / 86400000)
  return days >= 0 ? days : null
}

function calcPhase(daysSinceStart, cycleLength) {
  const day = (daysSinceStart % cycleLength) + 1
  if (day <= 5)               return 'menstrual'
  if (day >= 12 && day <= 16) return 'ovulatory'
  if (day <= 13)              return 'follicular'
  return 'luteal'
}

function phaseFromReported(reported) {
  const map = { menstrual: 'menstrual', follicular: 'follicular', ovulatory: 'ovulatory', luteal: 'luteal' }
  return map[reported] || 'unknown'
}

function inferCyclePhase(lastPeriodDate, avgCycleLength, isIrregular, recentLogs = []) {
  const recentLog = recentLogs.find(l => {
    const days = Math.floor((new Date() - new Date(l.log_date)) / 86400000)
    return days <= 3 && l.phase_reported
  })
  if (isIrregular) {
    if (recentLog) return phaseFromReported(recentLog.phase_reported)
    if (!lastPeriodDate || !avgCycleLength) return 'unknown'
    const days = daysSincePeriod(lastPeriodDate)
    if (days === null || days > 90) return 'unknown'
    return calcPhase(days, avgCycleLength)
  }
  if (!lastPeriodDate) return 'unknown'
  const days = daysSincePeriod(lastPeriodDate)
  if (days === null || days < 0) return 'unknown'
  const cycleLen = avgCycleLength || 28
  if (days > cycleLen * 2.5) return 'unknown'
  if (recentLog) return phaseFromReported(recentLog.phase_reported)
  return calcPhase(days, cycleLen)
}

// ── HR zones (mirrors hrZones.js) ────────────────────────────────────────────
function resolveZones(settings) {
  if (settings?.hr_zones?.zones) return settings.hr_zones
  if (settings?.training_zones) {
    const tz = settings.training_zones
    return {
      source: 'manual',
      zones: {
        z1: { min: 0,                max: tz.z1_max ?? 124 },
        z2: { min: tz.z2_min ?? 125, max: tz.z2_max ?? 140 },
        z3: { min: tz.z3_min ?? 141, max: tz.z3_max ?? 158 },
        z4: { min: tz.z4_min ?? 159, max: tz.z4_max ?? 172 },
        z5: { min: tz.z5_min ?? 173, max: 999 },
      },
    }
  }
  return {
    source: 'default',
    zones: {
      z1: { min: 0, max: 124 }, z2: { min: 125, max: 140 },
      z3: { min: 141, max: 158 }, z4: { min: 159, max: 172 }, z5: { min: 173, max: 999 },
    },
  }
}

function zonesPromptString(zones) {
  const z = zones.zones
  return `Z1 <${z.z1.max}bpm, Z2 ${z.z2.min}–${z.z2.max}bpm, Z3 ${z.z3.min}–${z.z3.max}bpm, Z4 ${z.z4.min}–${z.z4.max}bpm, Z5 >${z.z5.min}bpm`
}

// ── System prompt builder (mirrors coachingPrompt.js) ─────────────────────────
export function buildSystemPrompt(settings = {}, primarySport = null) {
  const tone         = settings.tone ?? 50
  const consequences = settings.consequences ?? 50
  const detail       = settings.detail_level ?? 50
  const reach        = settings.coaching_reach ?? 50
  const name         = settings.name || 'the athlete'

  const age = settings.dob
    ? Math.floor((Date.now() - new Date(settings.dob)) / (365.25 * 24 * 60 * 60 * 1000))
    : null
  const bioStr = [
    age ? `${age}yo` : null,
    settings.weight_kg ? `${settings.weight_kg}kg` : null,
    settings.height_cm ? `${settings.height_cm}cm` : null,
  ].filter(Boolean).join(', ')

  const sportCategory  = primarySport?.sport_category || settings.sport_category || null
  const sportLabel     = primarySport?.sport_raw || settings.sport_raw || settings.sport_category || settings.sport || 'sport'
  const lifecycleState = primarySport?.lifecycle_state || settings.lifecycle_state || null
  const targetDate     = primarySport?.target_date || settings.target_date || null
  const targetMetric   = primarySport?.target_metric || settings.target_metric || null
  const targetName     = primarySport?.current_goal_raw || settings.target_event_name || null

  const isRunning   = sportCategory === 'running' || settings.sport === 'running'
  const isEndurance = ['running', 'cycling', 'swimming', 'triathlon', 'hyrox'].includes(sportCategory)

  const goalType   = settings.goal_type || null
  const daysToTarget = targetDate
    ? Math.ceil((new Date(targetDate) - new Date()) / (24 * 60 * 60 * 1000))
    : null

  let targetStr = ''
  if (targetName && targetDate) {
    targetStr = `Training for ${targetName} on ${targetDate} (${daysToTarget} days).${targetMetric ? ' ' + targetMetric + '.' : ''}`
  } else if (targetMetric) {
    targetStr = targetMetric
  }

  const PHASE_LABELS = {
    planning: 'Planning', training: 'Training', taper: 'Taper',
    race_week: 'Race Week', recovery: 'Recovery', what_next: 'What Next', maintenance: 'Maintenance',
  }
  const phase = lifecycleState ? (PHASE_LABELS[lifecycleState] || lifecycleState) : null

  let personaIntro, personaFocus
  if (goalType === 'compete' || goalType === 'complete_event') {
    personaIntro = `You are a performance coach for ${name}${bioStr ? ` (${bioStr})` : ''}, specialising in ${sportLabel}.`
    personaFocus = 'Your primary lens is training load, race readiness, and periodisation. Every conversation should serve the goal of optimal preparation on race day.'
  } else if (goalType === 'body_composition') {
    personaIntro = `You are a body composition coach for ${name}${bioStr ? ` (${bioStr})` : ''}, training in ${sportLabel}.`
    personaFocus = 'Your primary lens is habits, nutrition adherence, and sustainable body composition change.'
  } else if (goalType === 'injury_recovery') {
    personaIntro = `You are a rehabilitation-focused coach for ${name}${bioStr ? ` (${bioStr})` : ''}, working through ${sportLabel}.`
    personaFocus = 'Your primary lens is conservative load management and safe return to training. Rehab comes first.'
  } else {
    personaIntro = `You are a personal coach for ${name}${bioStr ? ` (${bioStr})` : ''}, focused on ${sportLabel}.`
    personaFocus = 'Your approach is balanced — training, recovery, and lifestyle together.'
  }

  const LIFECYCLE_FOCUS = {
    planning:    'Focus: help the athlete set up their training plan, establish baselines, and build a realistic schedule.',
    training:    'Focus: session execution, load management, and progressive overload. Review recent training, flag compliance issues, suggest adjustments.',
    taper:       'Focus: volume reduction while maintaining intensity. Reassure — taper doubts are normal. No new stressors. Protect the work already done.',
    race_week:   'Focus: logistics, nutrition timing, mental preparation, and minimal training. Keep the athlete calm, confident, and rested.',
    recovery:    'Focus: active recovery only. Celebrate the effort and reflect on the event. No performance pressure.',
    what_next:   'Focus: celebrate the achievement, then explore what comes next.',
    maintenance: 'Focus: consistency over performance.',
  }
  const lifecycleFocus = lifecycleState ? LIFECYCLE_FOCUS[lifecycleState] : null

  const contextLines = [
    targetStr || null,
    phase ? `Current phase: ${phase}.` : null,
    settings.current_level ? `Athlete level: ${settings.current_level}.` : null,
    isEndurance ? (() => {
      const effectiveZones = resolveZones(settings)
      const zStr = zonesPromptString(effectiveZones)
      const src = effectiveZones.source !== 'default' ? ` (${effectiveZones.source})` : ''
      return `Training zones${src}: ${zStr}.`
    })() : null,
    settings.health_notes ? `Health: ${settings.health_notes}` : null,
    lifecycleFocus || null,
  ].filter(Boolean)

  const goalLabel = targetName || 'the goal'
  const toneDesc = tone < 25 ? 'Be brutally direct. No softening.'
    : tone < 50 ? 'Be direct and honest. No fluff.'
    : tone < 75 ? 'Be warm but firm. Acknowledge effort, hold high standards.'
    : 'Be encouragingly British. Firm guidance with dry humour and understatement.'

  const consequencesDesc = consequences < 25 ? 'Keep stakes low-key. Gentle nudges, no drama.'
    : consequences < 50 ? 'Be clear about what missed sessions cost.'
    : consequences < 75 ? `Make clear every session matters. Missed training has compounding effects on ${goalLabel}.`
    : `Every skipped session is a direct withdrawal from ${goalLabel}. Make this vivid when relevant.`

  const detailDesc = detail < 25 ? 'One key insight maximum.'
    : detail < 50 ? 'Brief summary and top 2 points.'
    : detail < 75 ? 'Clear analysis with supporting data. 3–4 points is fine.'
    : isEndurance ? 'Go deep. Full split analysis, zone breakdowns, pace variance, HR drift.'
    : 'Go deep. Detailed analysis with specific data points.'

  const reachDesc = reach < 25 ? `Focus only on ${sportLabel} training. Do not mention nutrition or lifestyle unless asked.`
    : reach < 50 ? 'Cover training primarily. Mention nutrition when relevant.'
    : reach < 75 ? 'Cover training and nutrition together. Flag alcohol and sleep when data is available.'
    : 'Full lifestyle coaching. Training, nutrition, alcohol, sleep — all feed into performance.'

  const body = [personaIntro, personaFocus, ...contextLines].join('\n')
  return `${body}\n\nSTYLE: Tone: ${toneDesc} Stakes: ${consequencesDesc} Detail: ${detailDesc} Scope: ${reachDesc}\n\nUse arrow symbol for bullets. Flag risks with warning symbol. One flag per issue, then move on.`
}

// ── Context formatter (mirrors buildContext.js formatContext()) ───────────────
function formatContext({
  activities = [], upcomingSessions = [], nutrition = [], memory = [],
  settings = null, cycle_context = null, primary_sport = null,
  all_sports = [], injury_reports = [],
} = {}) {
  const parts = []

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
    const today = new Date().toLocaleDateString('en-CA', { timeZone: TZ })
    const upcoming = (settings.races || [])
      .filter(r => r.date >= today)
      .sort((a, b) => a.date.localeCompare(b.date))
    if (upcoming.length > 0) {
      const next = upcoming[0]
      const daysTo = Math.ceil((new Date(next.date) - new Date()) / (24 * 60 * 60 * 1000))
      lines.push(`Next race: ${next.name} on ${next.date} (${daysTo}d) | target ${next.target}`)
    }
    if (settings.health_notes) lines.push(`Health: ${settings.health_notes}`)
    if (lines.length > 0) parts.push('ATHLETE:\n' + lines.map(l => `- ${l}`).join('\n'))

    const effectiveZones = resolveZones(settings)
    const zoneSource = effectiveZones.source === 'tt_5km' ? 'calibrated from 5km TT'
      : effectiveZones.source === 'auto_detected' ? 'auto-detected from training data'
      : effectiveZones.source === 'manual' ? 'manually configured' : 'default'
    parts.push(`HR ZONES (${zoneSource}): ${zonesPromptString(effectiveZones)}`)

    const activeFlags = (settings.health_flags || []).filter(f => f.status === 'active' || f.status === 'monitoring')
    if (activeFlags.length > 0) {
      parts.push('ACTIVE HEALTH FLAGS:\n' + activeFlags.map(f => `- ${f.label} (${f.status}): ${f.notes}`).join('\n'))
    }
  }

  if (all_sports.length > 0) {
    const sportLines = []
    if (primary_sport) {
      const ps = primary_sport
      let line = `Primary: ${ps.sport_raw}`
      if (ps.sport_category) line += ` (${ps.sport_category})`
      if (ps.lifecycle_state) line += ` — ${ps.lifecycle_state.replace(/_/g, ' ')} phase`
      if (ps.target_metric)   line += `, target: ${ps.target_metric}`
      if (ps.target_date) {
        const d = Math.ceil((new Date(ps.target_date) - new Date()) / (24 * 60 * 60 * 1000))
        line += `, race date: ${ps.target_date} (${d}d)`
      }
      sportLines.push(line)
    }
    const supporting = all_sports.filter(s => s.priority === 'supporting')
    if (supporting.length > 0)
      sportLines.push(`Supporting: ${supporting.map(s => s.sport_raw).join(', ')}`)
    const recovery = all_sports.filter(s => s.priority === 'recovery')
    if (recovery.length > 0)
      sportLines.push(`Recovery: ${recovery.map(s => s.sport_raw).join(', ')}`)
    if (sportLines.length > 0)
      parts.push('SPORTS CONTEXT:\n' + sportLines.map(l => `- ${l}`).join('\n'))
  }

  if (injury_reports.length > 0) {
    const injuryLines = injury_reports.map(r => {
      let assessment = null
      try { assessment = typeof r.claude_assessment === 'string' ? JSON.parse(r.claude_assessment) : r.claude_assessment } catch {}
      const date = r.reported_at?.slice(0, 10) || '?'
      const coachMsg = assessment?.coachMessage ? ` — ${assessment.coachMessage}` : r.athlete_notes ? ` — "${r.athlete_notes}"` : ''
      return `- ${r.body_location || 'Unspecified'} (${r.severity || 'unknown severity'}, ${r.status}, reported ${date})${coachMsg}`
    })
    parts.push('ACTIVE INJURY REPORTS:\n' + injuryLines.join('\n'))
  }

  if (activities.length > 0) {
    const todayLocal = new Date().toLocaleDateString('en-CA', { timeZone: TZ })
    const yesterdayLocal = new Date(Date.now() - 86400000).toLocaleDateString('en-CA', { timeZone: TZ })
    parts.push(
      'RECENT ACTIVITIES:\n' +
      activities.map(a => {
        const actDate = a.date?.slice(0, 10)
        const relLabel = actDate === todayLocal ? 'today' : actDate === yesterdayLocal ? 'yesterday' : actDate || '?'
        const bits = [relLabel, a.type, a.distance_km ? `${a.distance_km}km` : null,
          a.duration_min ? `${Math.round(a.duration_min)}min` : null,
          a.avg_hr ? `HR ${Math.round(a.avg_hr)}avg` : null,
          a.elevation_m ? `↑${Math.round(a.elevation_m)}m` : null,
          a.pace_per_km ? `${a.pace_per_km}/km` : null,
        ].filter(Boolean).join(', ')
        return `- ${a.name}: ${bits}`
      }).join('\n')
    )
  }

  if (upcomingSessions.length > 0) {
    parts.push(
      'UPCOMING SESSIONS:\n' +
      upcomingSessions.map(s => {
        const day = new Date(s.planned_date + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short' })
        const dur = s.duration_min_low ? ` ${s.duration_min_low}-${s.duration_min_high}min` : ''
        const zone = s.zone ? ` — ${s.zone}` : ''
        const done = s.status === 'completed' ? ' ✓' : ''
        return `- ${s.planned_date} (${day}): ${s.name}${zone}${dur}${done}`
      }).join('\n')
    )
  }

  if (nutrition.length > 0) {
    const food    = nutrition.filter(n => n.meal_type !== 'alcohol')
    const alcohol = nutrition.filter(n => n.meal_type === 'alcohol')
    const kcal    = food.reduce((s, n) => s + (n.calories || 0), 0)
    const protein = Math.round(food.reduce((s, n) => s + parseFloat(n.protein_g || 0), 0))
    const carbs   = Math.round(food.reduce((s, n) => s + parseFloat(n.carbs_g || 0), 0))
    const fat     = Math.round(food.reduce((s, n) => s + parseFloat(n.fat_g || 0), 0))
    const units   = alcohol.reduce((s, n) => s + parseFloat(n.alcohol_units || 0), 0)
    const nutLines = []
    if (kcal > 0 || protein > 0) nutLines.push(`${kcal}kcal, ${protein}g protein, ${carbs}g carbs, ${fat}g fat`)
    if (units > 0) nutLines.push(`Alcohol: ${units.toFixed(1)} units today`)
    if (food.length > 0) nutLines.push(`Meals: ${food.map(n => n.meal_name).filter(Boolean).join(', ')}`)
    if (nutLines.length > 0) parts.push("TODAY'S NUTRITION:\n" + nutLines.map(l => `- ${l}`).join('\n'))
  }

  if (memory.length > 0) {
    parts.push('RECENT COACHING EXCHANGES:\n' + memory.map(m => m.content).join('\n---\n'))
  }

  if (cycle_context?.tracking_enabled) {
    const { estimated_phase, is_irregular, days_since_period, recent_log } = cycle_context
    const lines = []
    const PHASE_LABELS = { menstrual: 'Menstrual', follicular: 'Follicular', ovulatory: 'Ovulatory', luteal: 'Luteal' }
    if (estimated_phase !== 'unknown' && PHASE_LABELS[estimated_phase]) {
      const dayNote = days_since_period != null ? ` (day ${days_since_period + 1} of cycle)` : ''
      const irregNote = is_irregular ? ' — irregular cycle, estimate only' : ''
      lines.push(`Estimated phase: ${PHASE_LABELS[estimated_phase]}${dayNote}${irregNote}`)
    } else {
      lines.push('Cycle phase: unknown — rely on user signals only')
    }
    if (recent_log?.phase_reported) lines.push(`User reported today: ${recent_log.phase_reported.replace(/_/g, ' ')}`)
    const GUIDANCE = {
      menstrual:  'Coaching: Acknowledge potential lower energy. Proactively offer lighter session options.',
      follicular: 'Coaching: Energy typically building. Good time to introduce new challenges.',
      ovulatory:  'Coaching: Often peak energy. Can support higher intensity if the athlete is up for it.',
      luteal:     'Coaching: Energy may reduce toward end of phase; PMS symptoms possible. Be especially attuned to mood and fatigue. Avoid pushing load increases.',
      unknown:    'Coaching: Phase unknown — check in regularly about energy and readiness.',
    }
    lines.push(GUIDANCE[estimated_phase] || GUIDANCE.unknown)
    parts.push('CYCLE CONTEXT:\n' + lines.map(l => `- ${l}`).join('\n'))
  }

  return parts.join('\n\n')
}

// ── Main export: fetch context + build system prompt for a user ───────────────
export async function getCoachingContext(userId) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: TZ })
  const in7Days = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toLocaleDateString('en-CA', { timeZone: TZ })

  const [
    { data: activities },
    { data: upcomingSessions },
    { data: nutrition },
    { data: memory },
    { data: settings },
    { data: cycleLogs },
    { data: sportsData },
    { data: injuryReports },
  ] = await Promise.all([
    testDb.from('activities').select('name,date,type,distance_km,duration_min,avg_hr,max_hr,elevation_m,pace_per_km,zone_data')
      .eq('user_id', userId).order('date', { ascending: false }).limit(10),
    testDb.from('scheduled_sessions').select('name,planned_date,session_type,zone,intensity,duration_min_low,duration_min_high,notes,status')
      .eq('user_id', userId).gte('planned_date', today).lte('planned_date', in7Days).order('planned_date').limit(7),
    testDb.from('nutrition_logs').select('calories,protein_g,carbs_g,fat_g,meal_type,alcohol_units,meal_name')
      .eq('user_id', userId).eq('date', today),
    testDb.from('coaching_memory').select('content,created_at,category')
      .eq('user_id', userId).order('created_at', { ascending: false }).limit(3),
    testDb.from('athlete_settings').select('name,dob,height_cm,weight_kg,races,goal_type,current_level,health_notes,cycle_tracking_enabled,cycle_length_avg,cycle_is_irregular,cycle_last_period_date,health_flags,training_zones,hr_zones,tone,consequences,detail_level,coaching_reach')
      .eq('user_id', userId).maybeSingle(),
    testDb.from('cycle_logs').select('phase_reported,override_intensity,notes,log_date')
      .eq('user_id', userId).order('log_date', { ascending: false }).limit(5),
    testDb.from('athlete_sports').select('*').eq('user_id', userId).eq('is_active', true).order('created_at'),
    testDb.from('injury_reports').select('body_location,severity,athlete_notes,claude_assessment,follow_up_due_date,status,reported_at')
      .eq('user_id', userId).in('status', ['active', 'monitoring']).order('reported_at', { ascending: false }).limit(5),
  ])

  const primarySport    = sportsData?.find(s => s.priority === 'primary') || sportsData?.[0] || null
  const supportingSports = sportsData?.filter(s => s.priority !== 'primary') || []

  let cycleContext = null
  if (settings?.cycle_tracking_enabled) {
    const phase = inferCyclePhase(
      settings.cycle_last_period_date,
      settings.cycle_length_avg,
      settings.cycle_is_irregular || false,
      cycleLogs || []
    )
    const daysSince = daysSincePeriod(settings.cycle_last_period_date)
    const todayLog = cycleLogs?.find(l => l.log_date === today) || null
    cycleContext = { tracking_enabled: true, estimated_phase: phase, is_irregular: settings.cycle_is_irregular || false, days_since_period: daysSince, recent_log: todayLog }
  }

  const systemPrompt = buildSystemPrompt(settings || {}, primarySport)
  const contextStr = formatContext({
    activities:       activities       || [],
    upcomingSessions: upcomingSessions || [],
    nutrition:        nutrition        || [],
    memory:           memory           || [],
    settings:         settings         || null,
    cycle_context:    cycleContext,
    primary_sport:    primarySport,
    supporting_sports: supportingSports,
    all_sports:       sportsData        || [],
    injury_reports:   injuryReports    || [],
  })

  return { systemPrompt, context: contextStr }
}
