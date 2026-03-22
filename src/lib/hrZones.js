import { supabase } from './supabase'

/**
 * Default HR zones — matches the agent system prompt:
 * Z1 <125 | Z2 125-140 | Z3 141-158 | Z4 159-172 | Z5 >172
 */
export const DEFAULT_HR_ZONES = {
  source: 'default',
  calculated_at: null,
  threshold_hr: null,
  zones: {
    z1: { min: 0,   max: 124 },
    z2: { min: 125, max: 140 },
    z3: { min: 141, max: 158 },
    z4: { min: 159, max: 172 },
    z5: { min: 173, max: 999 },
  },
}

/**
 * Returns the effective HR zones for the athlete.
 * Priority: hr_zones (calibrated) > training_zones (manual edits) > defaults
 */
export function resolveZones(settings) {
  if (settings?.hr_zones?.zones) {
    return settings.hr_zones
  }
  if (settings?.training_zones) {
    const tz = settings.training_zones
    return {
      source: 'manual',
      calculated_at: null,
      threshold_hr: null,
      zones: {
        z1: { min: 0,                   max: tz.z1_max ?? 124 },
        z2: { min: tz.z2_min ?? 125,    max: tz.z2_max ?? 140 },
        z3: { min: tz.z3_min ?? 141,    max: tz.z3_max ?? 158 },
        z4: { min: tz.z4_min ?? 159,    max: tz.z4_max ?? 172 },
        z5: { min: tz.z5_min ?? 173,    max: 999 },
      },
    }
  }
  return DEFAULT_HR_ZONES
}

/**
 * Fetches hr_zones from athlete_settings. Falls back to defaults.
 */
export async function getHRZones() {
  const { data: settings } = await supabase
    .from('athlete_settings')
    .select('hr_zones, training_zones')
    .maybeSingle()
  return resolveZones(settings)
}

/**
 * Calls the calibrate-zones edge function.
 * Returns { ok, zones, calibrated, reason? }
 */
export async function triggerZoneCalibration() {
  const { data: { session } } = await supabase.auth.getSession()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const jwt = session?.access_token
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/calibrate-zones`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': import.meta.env.VITE_SUPABASE_KEY,
      ...(jwt ? { 'Authorization': `Bearer ${jwt}` } : {}),
    },
    body: JSON.stringify({ user_id: user.id, method: 'both' }),
  })
  if (!res.ok) throw new Error(`Calibration failed: ${res.status}`)
  return res.json()
}

/**
 * Returns a compact zone string for coaching prompts.
 * e.g. "Z1 <125bpm, Z2 125-140bpm, Z3 141-158bpm, Z4 159-172bpm, Z5 >172bpm"
 */
export function zonesPromptString(zonesObj) {
  const z = zonesObj?.zones || DEFAULT_HR_ZONES.zones
  return `Z1 <${z.z1.max}bpm, Z2 ${z.z2.min}–${z.z2.max}bpm, Z3 ${z.z3.min}–${z.z3.max}bpm, Z4 ${z.z4.min}–${z.z4.max}bpm, Z5 >${z.z5.min}bpm`
}

/**
 * Classifies a heart rate value into a zone label.
 */
export function classifyHR(hr, zonesObj) {
  const z = zonesObj?.zones || DEFAULT_HR_ZONES.zones
  if (!hr) return null
  if (hr <= z.z1.max) return 'Z1'
  if (hr <= z.z2.max) return 'Z2'
  if (hr <= z.z3.max) return 'Z3'
  if (hr <= z.z4.max) return 'Z4'
  return 'Z5'
}
