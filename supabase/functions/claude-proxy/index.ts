import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY')

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// AC-085: Tool definitions available to the coach AI
const COACH_TOOLS = [
  {
    name: 'log_wellness_flag',
    description: 'Record an episodic wellness issue reported by the athlete during chat (illness, fatigue, stress, poor sleep, travel, or other)',
    input_schema: {
      type: 'object',
      properties: {
        flag_type: { type: 'string', enum: ['illness', 'fatigue', 'stress', 'poor_sleep_untracked', 'travel', 'other'] },
        severity: { type: 'string', enum: ['mild', 'moderate', 'severe'] },
        start_date: { type: 'string', description: 'YYYY-MM-DD' },
        end_date: { type: 'string', description: 'YYYY-MM-DD — omit if ongoing' },
        notes: { type: 'string', description: 'Additional context from athlete' },
      },
      required: ['flag_type', 'start_date'],
    },
  },
]

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { messages, system, model, max_tokens, tools, include_coach_tools } = await req.json()

    // Merge caller-provided tools with built-in coach tools if requested
    const mergedTools = include_coach_tools
      ? [...(tools ?? []), ...COACH_TOOLS]
      : (tools ?? undefined)

    const body: Record<string, unknown> = { model, max_tokens, system, messages }
    if (mergedTools && mergedTools.length > 0) body.tools = mergedTools

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_KEY!,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    const data = await resp.json()
    // Always return 200 so the client can read the body.
    // Errors from Anthropic are surfaced via data.type === 'error'.
    return new Response(JSON.stringify({ ...data, _status: resp.status }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })
  } catch (err) {
    return new Response(JSON.stringify({ type: 'error', error: { type: 'proxy_error', message: err.message } }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })
  }
})
