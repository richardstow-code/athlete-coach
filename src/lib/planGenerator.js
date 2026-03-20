import { supabase } from './supabase'
import { callClaude } from './claudeProxy'

/**
 * generatePlanDraft — builds a training plan draft using Claude and saves
 * it to the plan_drafts table.
 *
 * triggerContext: {
 *   trigger: 'new_race' | 'new_phase' | 'new_goal' | 'manual',
 *   race: { name, date, targetTime } | null,
 *   currentDate: 'YYYY-MM-DD',
 *   athleteSettings: object | null,
 * }
 *
 * Returns the new plan_drafts row id (uuid).
 */
export async function generatePlanDraft(triggerContext) {
  const { trigger, race, currentDate, athleteSettings } = triggerContext

  // 1. Fetch most recent baseline analysis
  const { data: baselineRows } = await supabase
    .from('coaching_memory')
    .select('content')
    .eq('category', 'baseline_analysis')
    .order('created_at', { ascending: false })
    .limit(1)
  const baselineAnalysis = baselineRows?.[0]?.content || null

  // 2. Fetch training plan template rows
  const { data: planTemplate } = await supabase
    .from('training_plan')
    .select('phase, week_day, session_type, name, duration_min_low, duration_min_high, zone, intensity, notes')
    .eq('active', true)
    .order('phase')
    .order('week_day')

  // 3. Build context strings
  const raceStr = race
    ? `Target event: ${race.name} on ${race.date}${race.targetTime ? ` (target time: ${race.targetTime})` : ''}`
    : 'No specific race — generate a general 12-week training block.'

  const athleteLines = athleteSettings
    ? [
        athleteSettings.name ? `Athlete: ${athleteSettings.name}` : null,
        athleteSettings.current_level ? `Level: ${athleteSettings.current_level}` : null,
        athleteSettings.training_days_per_week
          ? `Training days/week: ${athleteSettings.training_days_per_week}`
          : null,
        athleteSettings.sleep_hours_typical
          ? `Typical sleep: ${athleteSettings.sleep_hours_typical}h`
          : null,
        athleteSettings.health_notes ? `Health: ${athleteSettings.health_notes}` : null,
      ].filter(Boolean)
    : []

  const templateStr =
    planTemplate?.length
      ? `Template structure (for reference):\n${planTemplate
          .map(
            r =>
              `${r.phase} / Day ${r.week_day}: ${r.name} (${r.session_type}, ` +
              `${r.duration_min_low}-${r.duration_min_high}min, ${r.zone || r.intensity || 'moderate'})`
          )
          .join('\n')}`
      : 'No template available — generate a well-structured marathon training plan.'

  const systemPrompt = `You are an expert running coach generating a personalised training plan.

Respond ONLY with valid JSON (no markdown fences, no explanation outside the JSON):
{
  "summary": "plain English overview of the plan, 200-300 words covering weekly structure, key sessions, load progression, and assumptions",
  "sessions": [
    {
      "planned_date": "YYYY-MM-DD",
      "session_type": "run|trail|strength|rest",
      "name": "Session name",
      "duration_min_low": number,
      "duration_min_high": number,
      "intensity": "easy|moderate|hard|very hard",
      "zone": "Z1|Z2|Z3|Z4|Z5 or null",
      "notes": "specific coaching note for this session",
      "status": "planned"
    }
  ]
}

Generate sessions from today (${currentDate}) to the race date. Include rest days. Match the athlete's available training days. Build load progressively with a taper if there is enough time.`

  const userParts = [
    `Trigger: ${trigger}`,
    `Current date: ${currentDate}`,
    raceStr,
    athleteLines.length ? athleteLines.join('\n') : null,
    baselineAnalysis ? `Baseline analysis of recent training:\n${baselineAnalysis}` : null,
    templateStr,
  ].filter(Boolean)

  // 4. Call Claude
  const data = await callClaude({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4000,
    system: systemPrompt,
    messages: [{ role: 'user', content: userParts.join('\n\n') }],
  })

  const raw = data?.content?.[0]?.text || ''
  const cleaned = raw.replace(/```json\n?|```/g, '').trim()

  let parsed
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    throw new Error(
      'Plan generation failed — could not parse Claude response. Raw: ' +
        raw.slice(0, 300)
    )
  }

  if (!parsed.sessions?.length) {
    throw new Error('Plan generation returned no sessions.')
  }

  // 5. Insert into plan_drafts
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { data: draft, error } = await supabase
    .from('plan_drafts')
    .insert({
      user_id: user?.id,
      status: 'active',
      race_id: race?.name || null,
      phase: trigger,
      summary_text: parsed.summary || '',
      sessions: parsed.sessions,
      review_messages: [],
    })
    .select('id')
    .single()

  if (error) throw error
  return draft.id
}
