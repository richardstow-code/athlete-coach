/**
 * calibrate-zones — Calculates HR zones from real training data
 *
 * Called from:
 *   - Frontend (manual trigger via triggerZoneCalibration())
 *   - enrich-activity (auto every 10th activity)
 *
 * Input: { user_id, method: "tt_5km" | "auto_detect" | "both" }
 *
 * Methods:
 *   tt_5km      — uses avg HR of most recent 5km time trial
 *   auto_detect — 95th percentile avg HR from hard long efforts
 *   both        — prefers tt_5km if within 90 days, else auto_detect
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ── Zone boundaries using % of LTHR ──────────────────────────────────────────

function zonesFromLTHR(lthr: number) {
  return {
    z1: { min: 0,                         max: Math.round(lthr * 0.80) },
    z2: { min: Math.round(lthr * 0.81),   max: Math.round(lthr * 0.89) },
    z3: { min: Math.round(lthr * 0.90),   max: Math.round(lthr * 0.93) },
    z4: { min: Math.round(lthr * 0.94),   max: Math.round(lthr * 0.99) },
    z5: { min: Math.round(lthr * 1.00),   max: 999 },
  }
}

// ── Default zones (from system prompt) ───────────────────────────────────────

const DEFAULT_HR_ZONES = {
  source: 'default',
  calculated_at: new Date().toISOString(),
  threshold_hr: null,
  zones: {
    z1: { min: 0,   max: 124 },
    z2: { min: 125, max: 140 },
    z3: { min: 141, max: 158 },
    z4: { min: 159, max: 172 },
    z5: { min: 173, max: 999 },
  },
}

// ── Method 1: 5km TT calibration ─────────────────────────────────────────────

async function calibrateFromTT(supabase: ReturnType<typeof createClient>, userId: string, since90Days: string) {
  // Look for a recent 5km-ish effort
  const { data: acts } = await supabase
    .from('activities')
    .select('id, name, avg_hr, distance_km, duration_min, date')
    .eq('user_id', userId)
    .gte('date', since90Days)
    .gte('avg_hr', 150)
    .not('avg_hr', 'is', null)
    .order('date', { ascending: false })
    .limit(50)

  if (!acts?.length) return null

  const ttActivity = acts.find(a => {
    const distKm = parseFloat(String(a.distance_km || 0))
    const durationMin = parseFloat(String(a.duration_min || 0))
    const name = String(a.name || '').toLowerCase()

    const isRightDistance = distKm >= 4.8 && distKm <= 5.2
    const isFast = durationMin > 0 && durationMin < 30
    const hasKeyword = /5k|5km|tt|time trial|parkrun/i.test(name)

    return isRightDistance && (isFast || hasKeyword)
  })

  if (!ttActivity) return null

  const lthr = parseFloat(String(ttActivity.avg_hr))
  if (!lthr || lthr < 140 || lthr > 200) return null

  return {
    source: 'tt_5km' as const,
    calculated_at: new Date().toISOString(),
    threshold_hr: lthr,
    zones: zonesFromLTHR(lthr),
    activity_name: ttActivity.name,
    activity_date: String(ttActivity.date).slice(0, 10),
  }
}

// ── Method 2: Auto-detect from hard long efforts ──────────────────────────────

async function calibrateAutoDetect(supabase: ReturnType<typeof createClient>, userId: string) {
  const { data: acts } = await supabase
    .from('activities')
    .select('avg_hr, max_hr, duration_min')
    .eq('user_id', userId)
    .gte('max_hr', 170)
    .gte('duration_min', 30)
    .not('avg_hr', 'is', null)
    .order('date', { ascending: false })
    .limit(60)

  const hardEfforts = (acts || []).filter(a => parseFloat(String(a.avg_hr || 0)) > 140)
  if (hardEfforts.length < 3) return null

  // 95th percentile of avg_hr across hard efforts
  const avgHrs = hardEfforts.map(a => parseFloat(String(a.avg_hr))).sort((a, b) => a - b)
  const idx = Math.floor(avgHrs.length * 0.95)
  const lthr = avgHrs[Math.min(idx, avgHrs.length - 1)]

  if (!lthr || lthr < 140 || lthr > 200) return null

  return {
    source: 'auto_detected' as const,
    calculated_at: new Date().toISOString(),
    threshold_hr: Math.round(lthr),
    zones: zonesFromLTHR(lthr),
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    let userId: string
    let method: string

    try {
      const body = await req.json()
      userId = body.user_id
      method = body.method || 'both'
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    if (!userId) {
      return new Response(JSON.stringify({ error: 'user_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const since90Days = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    let result = null

    if (method === 'tt_5km') {
      result = await calibrateFromTT(supabase, userId, since90Days)
    } else if (method === 'auto_detect') {
      result = await calibrateAutoDetect(supabase, userId)
    } else {
      // 'both' — prefer TT if available within 90 days
      result = await calibrateFromTT(supabase, userId, since90Days)
      if (!result) {
        result = await calibrateAutoDetect(supabase, userId)
      }
    }

    if (!result) {
      // No data to calibrate — return current zones or defaults
      const { data: settings } = await supabase
        .from('athlete_settings')
        .select('hr_zones')
        .eq('user_id', userId)
        .maybeSingle()
      const current = settings?.hr_zones || DEFAULT_HR_ZONES
      return new Response(JSON.stringify({ ok: true, zones: current, calibrated: false, reason: 'Insufficient data for calibration' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Save to athlete_settings
    const { error: upsertErr } = await supabase
      .from('athlete_settings')
      .upsert({ user_id: userId, hr_zones: result, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })

    if (upsertErr) throw upsertErr

    console.log(`[calibrate-zones] Zones calibrated: source=${result.source} LTHR=${result.threshold_hr}`)
    return new Response(JSON.stringify({ ok: true, zones: result, calibrated: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  } catch (err) {
    console.error('[calibrate-zones] Error:', err.message)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
