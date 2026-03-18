import { supabase } from './supabase'

/**
 * Tier-2 progressive onboarding nudges.
 * Fired one per session in priority order when the underlying field is still
 * missing and the nudge hasn't been sent before.
 *
 * Each nudge defines:
 *   key        — unique key stored in onboarding_nudges_sent jsonb
 *   check      — returns true when the field still needs filling
 *   condition  — optional; nudge only fires when this passes (e.g. body-comp users only)
 *   question   — function(settings) → string shown to the user
 *   inferKey   — which key to pass to infer-athlete-context (maps to its input field name)
 */
const NUDGES = [
  {
    key: 'health_notes',
    check: s => !s.health_notes_raw,
    question: () =>
      'Quick check-in — any injuries, conditions, or physical limitations I should know about? ' +
      'Even minor things help me calibrate your training load correctly.',
    inferKey: 'health_notes_raw',
  },
  {
    key: 'benchmark',
    check: s => !s.benchmark_raw,
    question: s => {
      const sport = s.sport_category || s.sport_raw || 'your sport'
      return `What's a recent ${sport} performance I can use as a baseline? ` +
        `Something specific — a time, distance, weight, or session tells me exactly where you are right now.`
    },
    inferKey: 'benchmark_raw',
  },
  {
    key: 'training_days',
    check: s => s.training_days_per_week == null,
    question: () => 'How many days per week are you typically able to train at the moment?',
    inferKey: 'training_days_raw',
  },
  {
    key: 'sleep',
    check: s => s.sleep_hours_typical == null,
    question: () => 'How many hours of sleep do you usually get per night?',
    inferKey: 'sleep_raw',
  },
  {
    key: 'weight',
    check: s => s.current_weight_kg == null,
    condition: s => s.goal_type === 'body_composition',
    question: () => "What's your current weight? I'll use this to track body composition changes over time.",
    inferKey: 'weight_raw',
  },
]

/**
 * Returns the next nudge to fire for this session, or null if none.
 * A nudge fires only if its field is still empty AND it hasn't been sent before.
 */
export function getActiveNudge(settings) {
  if (!settings) return null
  const sent = settings.onboarding_nudges_sent || {}
  for (const nudge of NUDGES) {
    if (nudge.condition && !nudge.condition(settings)) continue
    if (sent[nudge.key]) continue
    if (nudge.check(settings)) return nudge
  }
  return null
}

/**
 * Calls infer-athlete-context with the nudge response, then marks the nudge
 * as sent in onboarding_nudges_sent. Called when the user submits an answer.
 */
export async function processNudgeResponse(nudge, responseText, settings) {
  const payload = { [nudge.inferKey]: responseText }

  // Carry forward sport_raw so Haiku has context for benchmark parsing
  if (nudge.inferKey === 'benchmark_raw' && settings.sport_raw) {
    payload.sport_raw = settings.sport_raw
  }

  // Fire-and-forget inference — non-fatal (edge function writes to DB directly)
  try {
    await supabase.functions.invoke('infer-athlete-context', { body: payload })
  } catch { /* non-fatal */ }

  await markNudgeSent(nudge.key)
}

/**
 * Marks a nudge as sent without saving any field data.
 * Called when the user skips a nudge.
 */
export async function markNudgeSent(nudgeKey) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  const { data } = await supabase
    .from('athlete_settings')
    .select('onboarding_nudges_sent')
    .maybeSingle()

  const sent = data?.onboarding_nudges_sent || {}
  await supabase
    .from('athlete_settings')
    .update({
      onboarding_nudges_sent: { ...sent, [nudgeKey]: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', user.id)
}
