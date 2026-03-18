import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ANTHROPIC_KEY          = Deno.env.get('ANTHROPIC_API_KEY')!
const SUPABASE_URL           = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY      = Deno.env.get('SUPABASE_ANON_KEY')!
const SUPABASE_SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ── System prompt for legacy (athlete_settings) inference ─────────────────────
const LEGACY_SYSTEM_PROMPT = `You are a sports data parser. Given raw text inputs from an athlete, extract structured information and return ONLY valid JSON — no markdown, no commentary.

Fields to return:
- sport_category: one of running | cycling | swimming | triathlon | strength | hyrox | yoga | team_sport | combat | other; null if not determinable
- target_event_name: specific event name if mentioned, else null
- target_date: ISO date YYYY-MM-DD if a date or month is mentioned; if year is ambiguous use next upcoming occurrence; else null
- target_metric: concise performance target e.g. "sub 2:00:00 half marathon", "lose 10kg"; else null
- benchmark_value: concise current fitness marker e.g. "5k in 28:00", "deadlift 120kg"; else null
- has_injury: true if any injury, condition, or physical limitation is mentioned; false otherwise
- current_level: one of beginner | returning | regular | competitive; null if not determinable
- training_days_per_week: integer 1-7 extracted from training frequency input; null if not provided
- sleep_hours_typical: decimal hours per night; if a range like "7-8" average to 7.5; null if not provided
- current_weight_kg: decimal kg; convert from pounds if unit mentioned (1 lb = 0.4536 kg); null if not provided

Only populate a field if the relevant input was provided. If a field cannot be inferred, use null.`

// ── System prompt for multi-sport inference ────────────────────────────────────
const SPORTS_SYSTEM_PROMPT = `You are a sports data parser. Given athlete sport and goal inputs, extract structured information and return ONLY valid JSON — no markdown, no commentary.

The top-level response must be a JSON object with:
- "athlete_settings": an object with these fields (infer from non-sport inputs if provided):
  - benchmark_value: concise current fitness marker; null if not provided
  - has_injury: true if any injury/limitation mentioned; false otherwise
  - current_level: one of beginner | returning | regular | competitive; null if not determinable
  - training_days_per_week: integer 1-7; null if not provided
  - sleep_hours_typical: decimal hours per night; null if not provided
  - current_weight_kg: decimal kg; null if not provided
- "sports": an array, one entry per input sport, each with:
  - id: the sport id passed in (copy exactly)
  - sport_category: one of running | cycling | swimming | triathlon | strength | hyrox | yoga | team_sport | combat | other; null if not determinable
  - target_metric: concise performance target e.g. "sub 3:10 marathon"; null if not mentioned
  - target_date: ISO date YYYY-MM-DD extracted from current_goal_raw; if year is ambiguous use next upcoming occurrence; null if not mentioned

Only populate a field if the relevant input was provided. If a field cannot be inferred, use null.`

interface LegacyInferredFields {
  sport_category:         string | null
  target_event_name:      string | null
  target_date:            string | null
  target_metric:          string | null
  benchmark_value:        string | null
  has_injury:             boolean
  current_level:          string | null
  training_days_per_week: number | null
  sleep_hours_typical:    number | null
  current_weight_kg:      number | null
}

interface SportInput {
  id?: string
  sport_raw: string
  current_goal_raw: string | null
}

interface SportInferred {
  id: string | null
  sport_category: string | null
  target_metric: string | null
  target_date: string | null
}

interface MultiSportResponse {
  athlete_settings: Partial<LegacyInferredFields>
  sports: SportInferred[]
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 401,
      })
    }

    const body = await req.json()
    const {
      sports,
      sport_raw, target_raw, benchmark_raw, health_notes_raw,
      training_days_raw, sleep_raw, weight_raw,
    } = body

    // Resolve authenticated user (needed for athlete_settings upsert)
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user }, error: authError } = await userClient.auth.getUser()
    if (authError || !user) throw new Error('Could not resolve authenticated user')

    // ── Multi-sport path ───────────────────────────────────────────────────────
    if (Array.isArray(sports) && sports.length > 0) {
      const sportsWithIds = sports as SportInput[]

      const userMessage = sportsWithIds.map((s, i) =>
        `Sport ${i + 1} (id: ${s.id ?? 'none'}): ${s.sport_raw}` +
        (s.current_goal_raw ? `\nGoal: ${s.current_goal_raw}` : '')
      ).join('\n\n') +
        (health_notes_raw ? `\n\nHealth notes: ${health_notes_raw}` : '') +
        (benchmark_raw     ? `\n\nCurrent fitness: ${benchmark_raw}` : '')

      const claudeResp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1024,
          system: SPORTS_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userMessage }],
        }),
      })

      if (!claudeResp.ok) {
        const err = await claudeResp.text()
        throw new Error(`Claude API error ${claudeResp.status}: ${err}`)
      }

      const claudeData = await claudeResp.json()
      const rawText = claudeData.content?.[0]?.text ?? '{}'

      let parsed: MultiSportResponse
      try {
        parsed = JSON.parse(rawText)
      } catch {
        throw new Error(`Failed to parse Claude response as JSON: ${rawText}`)
      }

      // Write athlete_settings inferred fields (non-sport)
      const settingsUpdates: Record<string, unknown> = { updated_at: new Date().toISOString() }
      const as = parsed.athlete_settings || {}
      if (benchmark_raw)                      settingsUpdates.benchmark_raw          = benchmark_raw
      if (health_notes_raw)                   settingsUpdates.health_notes_raw       = health_notes_raw
      if (as.benchmark_value        != null)  settingsUpdates.benchmark_value        = as.benchmark_value
      if (as.has_injury             != null)  settingsUpdates.has_injury             = as.has_injury
      if (as.current_level          != null)  settingsUpdates.current_level          = as.current_level
      if (as.training_days_per_week != null)  settingsUpdates.training_days_per_week = as.training_days_per_week
      if (as.sleep_hours_typical    != null)  settingsUpdates.sleep_hours_typical    = as.sleep_hours_typical
      if (as.current_weight_kg      != null)  settingsUpdates.current_weight_kg      = as.current_weight_kg

      await userClient
        .from('athlete_settings')
        .upsert({ user_id: user.id, ...settingsUpdates }, { onConflict: 'user_id' })

      // Write inferred values back to athlete_sports using service role client
      const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
      const sportInferences = parsed.sports || []

      for (const sportResult of sportInferences) {
        if (!sportResult.id) continue
        const sportUpdates: Record<string, unknown> = { updated_at: new Date().toISOString() }
        if (sportResult.sport_category != null) sportUpdates.sport_category = sportResult.sport_category
        if (sportResult.target_metric  != null) sportUpdates.target_metric  = sportResult.target_metric
        if (sportResult.target_date    != null) sportUpdates.target_date    = sportResult.target_date

        await serviceClient
          .from('athlete_sports')
          .update(sportUpdates)
          .eq('id', sportResult.id)
          .eq('user_id', user.id)
      }

      return new Response(JSON.stringify({ athlete_settings: as, sports: sportInferences }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── Legacy path (athlete_settings only) ───────────────────────────────────
    const userMessage = [
      sport_raw         ? `Sport/activity: ${sport_raw}`             : null,
      target_raw        ? `Goal/target: ${target_raw}`               : null,
      benchmark_raw     ? `Current fitness: ${benchmark_raw}`        : null,
      health_notes_raw  ? `Health notes: ${health_notes_raw}`        : null,
      training_days_raw ? `Training frequency: ${training_days_raw}` : null,
      sleep_raw         ? `Typical sleep: ${sleep_raw}`              : null,
      weight_raw        ? `Current weight: ${weight_raw}`            : null,
    ].filter(Boolean).join('\n')

    if (!userMessage) {
      return new Response(JSON.stringify({ error: 'No input fields provided' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      })
    }

    const claudeResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 512,
        system: LEGACY_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      }),
    })

    if (!claudeResp.ok) {
      const err = await claudeResp.text()
      throw new Error(`Claude API error ${claudeResp.status}: ${err}`)
    }

    const claudeData = await claudeResp.json()
    const rawText = claudeData.content?.[0]?.text ?? '{}'

    let inferred: LegacyInferredFields
    try {
      inferred = JSON.parse(rawText)
    } catch {
      throw new Error(`Failed to parse Claude response as JSON: ${rawText}`)
    }

    // Build update payload for athlete_settings
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }

    if (sport_raw)        updates.sport_raw        = sport_raw
    if (target_raw)       updates.target_raw       = target_raw
    if (benchmark_raw)    updates.benchmark_raw    = benchmark_raw
    if (health_notes_raw) updates.health_notes_raw = health_notes_raw

    if (inferred.benchmark_value        != null) updates.benchmark_value        = inferred.benchmark_value
    if (inferred.has_injury             != null) updates.has_injury             = inferred.has_injury
    if (inferred.current_level          != null) updates.current_level          = inferred.current_level
    if (inferred.training_days_per_week != null) updates.training_days_per_week = inferred.training_days_per_week
    if (inferred.sleep_hours_typical    != null) updates.sleep_hours_typical    = inferred.sleep_hours_typical
    if (inferred.current_weight_kg      != null) updates.current_weight_kg      = inferred.current_weight_kg

    const { error: dbError } = await userClient
      .from('athlete_settings')
      .upsert({ user_id: user.id, ...updates }, { onConflict: 'user_id' })

    if (dbError) throw new Error(`DB upsert error: ${dbError.message}`)

    return new Response(JSON.stringify(inferred), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})
