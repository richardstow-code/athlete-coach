import { supabase } from './supabase'

/**
 * Calls the infer-athlete-context edge function with raw text inputs.
 *
 * When a `sports` array is provided (multi-sport path), the edge function
 * infers per-sport fields (sport_category, target_metric, target_date) and
 * writes them back to athlete_sports. athlete_settings inference still runs
 * for non-sport fields (benchmark, health notes, etc.).
 *
 * When no `sports` array is provided, falls back to the legacy single-sport
 * path that infers everything into athlete_settings.
 */
export async function inferAthleteContext({
  sports,
  sport_raw,
  target_raw,
  benchmark_raw,
  health_notes_raw,
  training_days_raw,
  sleep_raw,
  weight_raw,
} = {}) {
  const body = Array.isArray(sports) && sports.length > 0
    ? { sports, benchmark_raw, health_notes_raw }
    : { sport_raw, target_raw, benchmark_raw, health_notes_raw, training_days_raw, sleep_raw, weight_raw }

  const { data, error } = await supabase.functions.invoke('infer-athlete-context', { body })
  if (error) throw new Error(error.message || 'Inference failed')
  return data
}
