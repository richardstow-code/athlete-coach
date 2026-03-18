import { supabase } from './supabase'

/**
 * Calls the infer-athlete-context edge function with raw text inputs.
 * The function infers structured fields and writes them (+ the raw inputs)
 * to athlete_settings via user-scoped RLS. Returns the inferred object.
 */
export async function inferAthleteContext({ sport_raw, target_raw, benchmark_raw, health_notes_raw }) {
  const { data, error } = await supabase.functions.invoke('infer-athlete-context', {
    body: { sport_raw, target_raw, benchmark_raw, health_notes_raw },
  })
  if (error) throw new Error(error.message || 'Inference failed')
  return data
}
