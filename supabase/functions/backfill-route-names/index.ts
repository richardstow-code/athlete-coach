/**
 * backfill-route-names
 * One-shot edge function to backfill names for athlete_routes where name IS NULL.
 * AC-092/AC-093
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Geocode result type
type GeocodeResult = {
  place_name: string | null
  nearest_feature: string | null
  region: string | null
}

// Implement generateRouteName in Deno (mirrors lib/routeNaming.ts)
function generateRouteName(p: {
  reverse_geocode: GeocodeResult
  sport_type: string | null
  distance_km: number | null
  is_loop: boolean | null
  start_lat: number
  start_lng: number
}): string {
  const feature = p.reverse_geocode.nearest_feature ?? p.reverse_geocode.place_name
  const distStr = p.distance_km
    ? `${Math.round(p.distance_km * 10) / 10}km`
    : ''
  const shape = p.is_loop ? 'loop' : 'route'

  if (feature) {
    return distStr ? `${feature} ${shape}, ${distStr}` : `${feature} ${shape}`
  }
  const coords = `${p.start_lat.toFixed(3)}, ${p.start_lng.toFixed(3)}`
  return distStr ? `${distStr} ${shape} near ${coords}` : `${shape} near ${coords}`
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    // Fetch all routes without a name
    const { data: routes, error: fetchError } = await supabase
      .from('athlete_routes')
      .select('id, start_lat, start_lng, sport_type, approx_distance_km, distance_km, is_loop')
      .is('name', null)
      .limit(100)

    if (fetchError) {
      return new Response(JSON.stringify({ error: fetchError.message }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      })
    }

    if (!routes?.length) {
      return new Response(JSON.stringify({ updated: 0, message: 'No routes to backfill' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    let updated = 0
    const errors: string[] = []

    for (const route of routes) {
      try {
        const lat = route.start_lat ?? 0
        const lng = route.start_lng ?? 0

        // Call route-planner for geocode
        let geocode: GeocodeResult = { place_name: null, nearest_feature: null, region: null }
        if (lat !== 0 && lng !== 0) {
          const { data: geocodeData, error: geocodeErr } = await supabase.functions.invoke(
            'route-planner',
            { body: { action: 'geocode', lat, lng } }
          )
          if (!geocodeErr && geocodeData) {
            geocode = {
              place_name: geocodeData.place_name ?? null,
              nearest_feature: geocodeData.nearest_feature ?? null,
              region: geocodeData.region ?? null,
            }
          }
        }

        const distKm = route.approx_distance_km ?? route.distance_km ?? null
        const name = generateRouteName({
          reverse_geocode: geocode,
          sport_type: route.sport_type ?? null,
          distance_km: distKm,
          is_loop: route.is_loop ?? null,
          start_lat: lat,
          start_lng: lng,
        })

        // Derive coach_suitable_for tags
        const tags: string[] = []
        const km = distKm ?? 0
        if (route.sport_type === 'run' || route.sport_type === 'trailrun') {
          if (km < 6) tags.push('recovery', 'easy')
          else if (km < 12) tags.push('aerobic', 'steady')
          else tags.push('long_run')
        }
        if (route.sport_type === 'trailrun') tags.push('trail')

        await supabase
          .from('athlete_routes')
          .update({
            name,
            reverse_geocode_name: geocode.place_name ?? geocode.nearest_feature,
            coach_suitable_for: tags.length > 0 ? tags : null,
          })
          .eq('id', route.id)

        updated++
      } catch (err: any) {
        errors.push(`Route ${route.id}: ${err.message}`)
      }

      // Rate limit: 250ms between geocode calls
      await sleep(250)
    }

    return new Response(JSON.stringify({ updated, errors, total: routes.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})
