export function buildSystemPrompt(settings = {}) {
  const tone = settings.tone ?? 50
  const consequences = settings.consequences ?? 50
  const detail = settings.detail_level ?? 50
  const reach = settings.coaching_reach ?? 50
  const name = settings.name || 'the athlete'

  // Bio
  const age = settings.dob
    ? Math.floor((Date.now() - new Date(settings.dob)) / (365.25 * 24 * 60 * 60 * 1000))
    : null
  const bioStr = [
    age ? `${age}yo` : null,
    settings.weight_kg ? `${settings.weight_kg}kg` : null,
    settings.height_cm ? `${settings.height_cm}cm` : null,
  ].filter(Boolean).join(', ')

  // Sport
  const sport = settings.sport === 'other'
    ? (settings.sport_other || 'sport')
    : (settings.sport || 'running')

  // Target
  const targetName = settings.target_event_name || null
  const targetDate = settings.target_date || null
  const targetDesc = settings.target_description || null
  const daysToTarget = targetDate
    ? Math.ceil((new Date(targetDate) - new Date()) / (24 * 60 * 60 * 1000))
    : null

  let targetStr = ''
  if (targetName && targetDate) {
    targetStr = `Training for ${targetName} on ${targetDate} (${daysToTarget} days).${targetDesc ? ' ' + targetDesc + '.' : ''}`
  } else if (targetDesc) {
    targetStr = targetDesc
  }

  // Phase
  const PHASE_LABELS = {
    base_build: 'Base Build', build: 'Build', peak: 'Peak',
    taper: 'Taper', race: 'Race Week', recovery: 'Recovery', off_season: 'Off-Season',
  }
  const phase = settings.lifecycle_state
    ? (PHASE_LABELS[settings.lifecycle_state] || settings.lifecycle_state)
    : null

  // Style sliders
  const toneDesc = tone < 25
    ? 'Be brutally direct. No softening. Call out failures plainly.'
    : tone < 50
    ? 'Be direct and honest. No fluff. State facts and move on.'
    : tone < 75
    ? 'Be warm but firm. Acknowledge effort, hold high standards.'
    : 'Be encouragingly British. Firm guidance with dry humour and understatement.'

  const consequencesDesc = consequences < 25
    ? 'Keep stakes low-key. Gentle nudges, no drama.'
    : consequences < 50
    ? 'Be clear about what missed sessions cost. State consequences plainly.'
    : consequences < 75
    ? `Make clear every session matters. Missed training has compounding effects${targetName ? ` on ${targetName}` : ''}.`
    : `${targetName && daysToTarget ? `${targetName} is ${daysToTarget} days away. ` : ''}Every skipped session and zone violation is a direct withdrawal from race day. Make this vivid when relevant.`

  const detailDesc = detail < 25
    ? 'One key insight maximum. Lead with the single most important point only.'
    : detail < 50
    ? 'Brief summary and top 2 points. Keep it scannable.'
    : detail < 75
    ? 'Clear analysis with supporting data. 3-4 points is fine.'
    : 'Go deep. Full split analysis, zone breakdowns, pace variance, HR drift. The athlete wants to understand the mechanism.'

  const reachDesc = reach < 25
    ? `Focus only on ${sport} and strength. Do not mention nutrition or lifestyle unless asked.`
    : reach < 50
    ? 'Cover training primarily. Mention nutrition when calorie burn is high or race nutrition is relevant.'
    : reach < 75
    ? 'Cover training and nutrition together. Flag alcohol and sleep when data is available.'
    : 'Full lifestyle coaching. Training, nutrition, alcohol, sleep — all feed into race performance. Comment on all dimensions when data is present.'

  const lines = [
    `You are a personal ${sport} coach for ${name}${bioStr ? ` (${bioStr})` : ''}.`,
    targetStr || null,
    phase ? `Current phase: ${phase}.` : null,
    settings.current_level ? `Athlete level: ${settings.current_level}.` : null,
    'Training zones: Z1 <125bpm, Z2 125-140bpm, Z3 140-158bpm, Z4 158-172bpm, Z5 >172bpm.',
    'Location: Taxach/Rif, Salzburg, Austria. Local routes: Salzach valley (flat), Bad Durrnberg/Zinkenkopf (490m vert, 10min drive), Untersberg (summit 1853m, 15min drive).',
    settings.health_notes ? `Health: ${settings.health_notes}` : null,
  ].filter(Boolean).join('\n')

  return `${lines}

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
