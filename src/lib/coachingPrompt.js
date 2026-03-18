export function buildSystemPrompt(settings = {}) {
  const tone         = settings.tone ?? 50
  const consequences = settings.consequences ?? 50
  const detail       = settings.detail_level ?? 50
  const reach        = settings.coaching_reach ?? 50
  const name         = settings.name || 'the athlete'

  // ── Bio ───────────────────────────────────────────────────
  const age = settings.dob
    ? Math.floor((Date.now() - new Date(settings.dob)) / (365.25 * 24 * 60 * 60 * 1000))
    : null
  const bioStr = [
    age ? `${age}yo` : null,
    settings.weight_kg ? `${settings.weight_kg}kg` : null,
    settings.height_cm ? `${settings.height_cm}cm` : null,
  ].filter(Boolean).join(', ')

  // ── Sport ─────────────────────────────────────────────────
  const sportCategory = settings.sport_category || null
  const sportLabel = settings.sport_raw
    || settings.sport_category
    || (settings.sport === 'other' ? (settings.sport_other || 'sport') : settings.sport)
    || 'sport'
  const isRunning   = sportCategory === 'running' || settings.sport === 'running'
  const isEndurance = ['running', 'cycling', 'swimming', 'triathlon', 'hyrox'].includes(sportCategory)

  // ── Goal & target ─────────────────────────────────────────
  const goalType     = settings.goal_type || null
  const targetName   = settings.target_event_name || null
  const targetDate   = settings.target_date || null
  const targetDesc   = settings.target_description || settings.target_metric || null
  const daysToTarget = targetDate
    ? Math.ceil((new Date(targetDate) - new Date()) / (24 * 60 * 60 * 1000))
    : null

  let targetStr = ''
  if (targetName && targetDate) {
    targetStr = `Training for ${targetName} on ${targetDate} (${daysToTarget} days).${targetDesc ? ' ' + targetDesc + '.' : ''}`
  } else if (targetDesc) {
    targetStr = targetDesc
  }

  // ── Phase ─────────────────────────────────────────────────
  const PHASE_LABELS = {
    planning: 'Planning', training: 'Training', taper: 'Taper',
    race_week: 'Race Week', recovery: 'Recovery', what_next: 'What Next', maintenance: 'Maintenance',
  }
  const phase = settings.lifecycle_state
    ? (PHASE_LABELS[settings.lifecycle_state] || settings.lifecycle_state)
    : null

  // ── Persona by goal_type ──────────────────────────────────
  let personaIntro, personaFocus
  if (goalType === 'compete' || goalType === 'complete_event') {
    personaIntro = `You are a performance coach for ${name}${bioStr ? ` (${bioStr})` : ''}, specialising in ${sportLabel}.`
    personaFocus = 'Your primary lens is training load, race readiness, and periodisation. Every conversation should serve the goal of optimal preparation on race day.'
  } else if (goalType === 'body_composition') {
    personaIntro = `You are a body composition coach for ${name}${bioStr ? ` (${bioStr})` : ''}, training in ${sportLabel}.`
    personaFocus = 'Your primary lens is habits, nutrition adherence, and sustainable body composition change. Training supports the goal — but nutrition and lifestyle patterns carry equal weight.'
  } else if (goalType === 'injury_recovery') {
    personaIntro = `You are a rehabilitation-focused coach for ${name}${bioStr ? ` (${bioStr})` : ''}, working through ${sportLabel}.`
    personaFocus = 'Your primary lens is conservative load management and safe return to training. Rehab comes first — flag any risk of aggravating injury immediately and always suggest load modifications.'
  } else {
    // general_fitness or unknown
    personaIntro = `You are a personal coach for ${name}${bioStr ? ` (${bioStr})` : ''}, focused on ${sportLabel}.`
    personaFocus = 'Your approach is balanced — training, recovery, and lifestyle together. No single dimension dominates.'
  }

  // ── Lifecycle focus ───────────────────────────────────────
  const LIFECYCLE_FOCUS = {
    planning:    'Focus: help the athlete set up their training plan, establish baselines, and build a realistic schedule. Ask questions, surface gaps, confirm the goal.',
    training:    'Focus: session execution, load management, and progressive overload. Review recent training, flag compliance issues, suggest adjustments.',
    taper:       'Focus: volume reduction while maintaining intensity. Reassure — taper doubts are normal. No new stressors. Protect the work already done.',
    race_week:   'Focus: logistics, nutrition timing, mental preparation, and minimal training. Keep the athlete calm, confident, and rested. Avoid anything that adds anxiety.',
    recovery:    'Focus: active recovery only. Celebrate the effort and reflect on the event. No performance pressure. Protect sleep, easy movement, and mental reset.',
    what_next:   'Focus: celebrate the achievement, then explore what comes next. Help the athlete articulate their next goal. Keep energy high, avoid a vacuum.',
    maintenance: 'Focus: consistency over performance. Flexible scheduling is fine. Keep the athlete moving and engaged without peaking or heavy load.',
  }
  const lifecycleFocus = settings.lifecycle_state ? LIFECYCLE_FOCUS[settings.lifecycle_state] : null

  // ── Athlete context ───────────────────────────────────────
  const contextLines = [
    targetStr || null,
    phase ? `Current phase: ${phase}.` : null,
    settings.current_level ? `Athlete level: ${settings.current_level}.` : null,
    isEndurance
      ? 'Training zones: Z1 <125bpm, Z2 125–140bpm, Z3 140–158bpm, Z4 158–172bpm, Z5 >172bpm.'
      : null,
    isRunning
      ? 'Location: Taxach/Rif, Salzburg, Austria. Local routes: Salzach valley (flat), Bad Dürrnberg/Zinkenkopf (490m vert, 10min drive), Untersberg (summit 1853m, 15min drive).'
      : null,
    settings.health_notes ? `Health: ${settings.health_notes}` : null,
    lifecycleFocus || null,
  ].filter(Boolean)

  // ── Style sliders ─────────────────────────────────────────
  const toneDesc = tone < 25
    ? 'Be brutally direct. No softening. Call out failures plainly.'
    : tone < 50
    ? 'Be direct and honest. No fluff. State facts and move on.'
    : tone < 75
    ? 'Be warm but firm. Acknowledge effort, hold high standards.'
    : 'Be encouragingly British. Firm guidance with dry humour and understatement.'

  const goalLabel = targetName || 'the goal'
  const consequencesDesc = consequences < 25
    ? 'Keep stakes low-key. Gentle nudges, no drama.'
    : consequences < 50
    ? 'Be clear about what missed sessions cost. State consequences plainly.'
    : consequences < 75
    ? `Make clear every session matters. Missed training has compounding effects on ${goalLabel}.`
    : `${targetName && daysToTarget ? `${targetName} is ${daysToTarget} days away. ` : ''}Every skipped session is a direct withdrawal from ${goalLabel}. Make this vivid when relevant.`

  const detailDesc = detail < 25
    ? 'One key insight maximum. Lead with the single most important point only.'
    : detail < 50
    ? 'Brief summary and top 2 points. Keep it scannable.'
    : detail < 75
    ? 'Clear analysis with supporting data. 3–4 points is fine.'
    : isEndurance
    ? 'Go deep. Full split analysis, zone breakdowns, pace variance, HR drift. The athlete wants to understand the mechanism.'
    : 'Go deep. Detailed analysis with specific data points. The athlete wants to understand the mechanism.'

  const reachDesc = reach < 25
    ? `Focus only on ${sportLabel} training. Do not mention nutrition or lifestyle unless asked.`
    : reach < 50
    ? 'Cover training primarily. Mention nutrition when relevant to performance or recovery.'
    : reach < 75
    ? 'Cover training and nutrition together. Flag alcohol and sleep when data is available.'
    : 'Full lifestyle coaching. Training, nutrition, alcohol, sleep — all feed into performance. Comment on all dimensions when data is present.'

  // ── Assemble ──────────────────────────────────────────────
  const body = [personaIntro, personaFocus, ...contextLines].join('\n')

  return `${body}

STYLE: Tone: ${toneDesc} Stakes: ${consequencesDesc} Detail: ${detailDesc} Scope: ${reachDesc}

Use arrow symbol for bullets. Flag risks with warning symbol. One flag per issue, then move on.`
}

export async function fetchAndBuildPrompt(supabaseClient) {
  try {
    const { data } = await supabaseClient.from('athlete_settings').select('*').maybeSingle()
    return buildSystemPrompt(data || {})
  } catch {
    return buildSystemPrompt({})
  }
}
