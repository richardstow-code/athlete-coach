// claude-proxy.js — pass-through to Anthropic for non-agentic surfaces
// (briefing, route coach, chat coach, activity Coach's-Take).
//
// Build 27 T3: when the body declares surface_type='activity_feedback'
// (with activity_id), the proxy fetches the canonical coaching context
// via get_athlete_coaching_context(user_id, 'activity_feedback',
// activity_id), prepends it to the system prompt with the NEVER
// FABRICATE rule, and persists the resulting Coach's Take to
// coaching_memory with prompt_data_completeness audit. This replaces
// the generic boilerplate that ignored plan-vs-actual and injury
// context.
//
// All other call shapes (no surface_type, or surface_type that the
// proxy doesn't enrich) keep behaving as the lean pass-through —
// preserving the briefing path that AC-144 P2 / Build 26 rely on.

export const config = { maxDuration: 30 };

const SUPABASE_URL = 'https://yjuhzmknabedjklsgbje.supabase.co';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

function corsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization');
}

async function verifyJWT(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const jwt = authHeader.slice(7).trim();
  if (!jwt) return null;
  const resp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: process.env.SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${jwt}`,
    },
  });
  if (!resp.ok) return null;
  const user = await resp.json();
  return user?.id || null;
}

async function callRPC(fnName, body) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fnName}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: process.env.SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SECRET_KEY}`,
    },
    body: JSON.stringify(body),
  });
  let data = null;
  try { data = await resp.json(); } catch {}
  return { ok: resp.ok, status: resp.status, data };
}

async function persistCoachTake({ userId, activityId, content, audit }) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Vienna' });
  await fetch(`${SUPABASE_URL}/rest/v1/coaching_memory`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: process.env.SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SECRET_KEY}`,
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      user_id: userId,
      activity_id: activityId,
      type: 'activity_feedback',
      source: 'activity-trigger',
      category: 'feedback',
      content,
      date: today,
    }),
  }).catch(() => {});

  // Stash the audit on activities.raw_data so detect_coach_take_hallucinations
  // has a single place to look. (We avoid adding a new column.)
  await fetch(
    `${SUPABASE_URL}/rest/v1/activities?id=eq.${activityId}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        apikey: process.env.SUPABASE_SECRET_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SECRET_KEY}`,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        // raw_data is jsonb — merge an audit subfield.
        raw_data: { coach_take_audit: audit },
      }),
    }
  ).catch(() => {});
}

// Build 27 T3: canonical Coach's-Take system prompt.
function buildCoachTakeSystemPrompt(ctx) {
  const core = (ctx && ctx.core) || {};
  const extras = (ctx && ctx.surface_extras) || {};
  const ath = core.athlete || {};
  const character = ath.coaching_character || 'standard';
  const dc = core.data_completeness || {};
  const missing = Array.isArray(dc.missing_metrics) ? dc.missing_metrics : [];
  const missingLine = missing.length === 0
    ? 'All canonical metrics are present.'
    : `NOT AVAILABLE today: ${missing.join(', ')}. Do NOT reference these metrics, do NOT estimate, do NOT invent values.`;

  const linkedSession = extras.linked_session;
  const planVsActual = extras.plan_vs_actual;
  const activity     = extras.activity;
  const subj         = extras.subjective_notes;
  const injuries     = Array.isArray(core.active_injuries) ? core.active_injuries : [];

  const sportLine = core.primary_sport && core.primary_sport.sport_raw
    ? `primary sport: ${core.primary_sport.sport_raw}`
    : 'sport unspecified';

  return `You are an elite multi-sport coach writing this athlete's Coach's Take for the activity they just completed.

ATHLETE: ${ath.name || 'unknown'} — ${sportLine} — coaching_character=${character}.
${missingLine}

ACTIVITY:
${JSON.stringify(activity, null, 0)}

LINKED PLANNED SESSION (null if athlete went off-plan):
${JSON.stringify(linkedSession, null, 0)}

PLAN VS ACTUAL:
${JSON.stringify(planVsActual, null, 0)}

SUBJECTIVE (raw — RPE 1-10, feel_legs, injury_flag):
${JSON.stringify(subj, null, 0)}

ACTIVE INJURIES:
${JSON.stringify(injuries, null, 0)}

ABSOLUTE RULES:
  1. NEVER FABRICATE METRICS. Anything in the missing list is off-limits.
  2. RPE IS RAW. Low RPE on an easy session = good execution, not poor feel. Read raw RPE alongside planned-session intensity.
  3. PLAN-FIRST. If a linked session exists, your take MUST address how the actual aligned to (or diverged from) the plan: zone match, duration vs the planned range, intensity character.
  4. INJURY-AWARE. If active_injuries is non-empty, acknowledge in one short clause how this session interacts with the injury (e.g. "the 7/10 effort on a calf-management week is borderline").
  5. NO BOILERPLATE. No "great work today!", no generic "keep it up". Each sentence must reference SPECIFIC values from the data above.
  6. MULTI-SPORT. Don't assume the athlete only runs.

OUTPUT: 2-4 short sentences. Plain text, no markdown, no emojis, no sign-offs.`;
}

function buildAuditFromContext(ctx) {
  const core = (ctx && ctx.core) || {};
  const extras = (ctx && ctx.surface_extras) || {};
  const dc = core.data_completeness || {};
  const ath = core.athlete || {};
  const subj = extras.subjective_notes || {};
  const linked = extras.linked_session;
  return {
    prompt_version: 'coach-take@v1',
    coaching_character: ath.coaching_character || 'standard',
    has_sleep:           !!dc.has_sleep,
    has_hrv:             !!dc.has_hrv,
    has_resting_hr:      !!dc.has_resting_hr,
    has_zone_data_today: !!dc.has_zone_data_today,
    has_plan_for_today:  !!dc.has_plan_for_today,
    has_linked_session:  !!linked,
    has_subjective:      subj.captured_at != null,
    rpe_value:           subj.rpe ?? null,
    feel_legs:           subj.feel_legs ?? null,
    injury_flag:         subj.injury_flag ?? null,
    missing_metrics:     dc.missing_metrics || [],
  };
}

export default async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    model, max_tokens, system, messages, tools, tool_choice,
    surface_type, activity_id,
  } = req.body || {};

  // Build 27 T3 — Coach's-Take enrichment.
  if (surface_type === 'activity_feedback' && activity_id) {
    const userId = await verifyJWT(req.headers.authorization || req.headers.Authorization);
    if (!userId) {
      return res.status(401).json({ type: 'error', error: { type: 'auth_error', message: 'unauthorized' } });
    }

    const ctxResp = await callRPC('get_athlete_coaching_context', {
      p_user_id: userId,
      p_surface_type: 'activity_feedback',
      p_activity_id: activity_id,
    });
    if (!ctxResp.ok) {
      return res.status(500).json({
        type: 'error',
        error: { type: 'context_error', message: `context fetch failed: ${ctxResp.status}` },
      });
    }

    const ctx = ctxResp.data;
    const enrichedSystem = buildCoachTakeSystemPrompt(ctx);
    const audit = buildAuditFromContext(ctx);

    const upstreamBody = {
      model: model || 'claude-haiku-4-5-20251001',
      max_tokens: max_tokens || 400,
      system: enrichedSystem,
      messages: messages && messages.length > 0
        ? messages
        : [{ role: 'user', content: 'Write the Coach\'s Take for the activity above.' }],
    };

    try {
      const resp = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': ANTHROPIC_VERSION,
          'content-type': 'application/json',
        },
        body: JSON.stringify(upstreamBody),
      });
      const data = await resp.json();
      const text = (data?.content || [])
        .filter(b => b.type === 'text')
        .map(b => b.text || '')
        .join('\n')
        .trim();

      if (text) {
        await persistCoachTake({ userId, activityId: activity_id, content: text, audit });
      }
      return res.status(200).json({
        ...data,
        _surface_type: 'activity_feedback',
        _audit: audit,
        _status: resp.status,
      });
    } catch (err) {
      return res.status(200).json({
        type: 'error',
        error: { type: 'proxy_error', message: err.message },
        _surface_type: 'activity_feedback',
        _audit: audit,
      });
    }
  }

  // ── Default pass-through (briefing, route coach, chat) ────────────
  // AC-144 P2: pass `tools` and `tool_choice` through so the coach
  // chat surface can use propose_schedule_change. Other fields are
  // unchanged.
  try {
    const body = { model, max_tokens, system, messages };
    if (Array.isArray(tools) && tools.length > 0) body.tools = tools;
    if (tool_choice) body.tool_choice = tool_choice;

    const resp = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const data = await resp.json();
    return res.status(200).json({ ...data, _status: resp.status });
  } catch (err) {
    return res.status(200).json({
      type: 'error',
      error: { type: 'proxy_error', message: err.message },
    });
  }
}
