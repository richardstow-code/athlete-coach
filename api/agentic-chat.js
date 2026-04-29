// Build 27 T1: server-side agentic chat endpoint.
//
// Both native chat surfaces (standalone Chat tab + Plan-tab embedded
// chat) POST here with the same contract. The server runs the
// Anthropic tool-use loop, dispatches each tool_use to a Supabase RPC
// (with p_user_id derived from the JWT — never trusted from the body),
// returns the final assistant text plus any pending proposal_ids the
// model created for the native UI to render.
//
// Companion module to api/claude-proxy.js — we keep that endpoint as
// the lean pass-through used by briefing / route-coach / activity
// coach's-take. agentic-chat owns the loop + side-effect surface.

export const config = { maxDuration: 60 };

const SUPABASE_URL = 'https://yjuhzmknabedjklsgbje.supabase.co';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const MAX_ITERATIONS = 5;
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const DEFAULT_MAX_TOKENS = 2048;

// Keep these in lockstep with the four RPCs. session_id and
// schedule_change_id are bigints — declare as type:integer.
const TOOLS = [
  {
    name: 'list_upcoming_sessions',
    description:
      "Read-only. Get the user's scheduled sessions in a date window. ALWAYS call this BEFORE proposing a change so you know what is actually planned. Returns sessions with id, planned_date, name, session_type, zone, intensity, duration, status, notes.",
    input_schema: {
      type: 'object',
      properties: {
        date_from: { type: 'string', format: 'date', description: 'Optional. Defaults to today.' },
        date_to:   { type: 'string', format: 'date', description: 'Optional. Defaults to today + 14 days. Capped at 60 days server-side.' },
      },
    },
  },
  {
    name: 'propose_schedule_change',
    description:
      'Draft a schedule change for the user to review. Does NOT mutate scheduled_sessions — creates a row in schedule_changes with status=pending. After calling this, tell the user what you proposed in plain language and ASK THEM TO CONFIRM. Wait for the user\'s NEXT message before applying. Never apply on assumed consent.',
    input_schema: {
      type: 'object',
      properties: {
        session_id: { type: 'integer', description: 'The bigint id of the scheduled session to modify. Get from list_upcoming_sessions.' },
        action: {
          type: 'string',
          enum: ['reschedule', 'modify_duration', 'modify_intensity', 'rename', 'remove'],
          description: "reschedule needs new_date. modify_duration needs new_duration_low and/or new_duration_high. modify_intensity needs new_intensity. rename needs new_name. remove needs no extras. 'remove' soft-cancels by setting status='superseded'; it does NOT hard-delete.",
        },
        new_date:         { type: 'string', format: 'date' },
        new_duration_low: { type: 'integer' },
        new_duration_high:{ type: 'integer' },
        new_intensity:    { type: 'string' },
        new_name:         { type: 'string' },
        reason:           { type: 'string', description: 'Why this change is being proposed. Stored on the schedule_changes row.' },
      },
      required: ['session_id', 'action', 'reason'],
    },
  },
  {
    name: 'apply_schedule_change',
    description:
      'Apply a previously proposed schedule change after the user confirms. Only call this when the user has explicitly confirmed in their last message. Idempotent on re-apply.',
    input_schema: {
      type: 'object',
      properties: {
        schedule_change_id: { type: 'integer', description: 'The bigint id returned from propose_schedule_change.' },
      },
      required: ['schedule_change_id'],
    },
  },
  {
    name: 'cancel_proposal',
    description: 'Dismiss a previously proposed schedule change.',
    input_schema: {
      type: 'object',
      properties: {
        schedule_change_id: { type: 'integer' },
        reason:             { type: 'string' },
      },
      required: ['schedule_change_id'],
    },
  },
];

const TOOL_NAMES = new Set(TOOLS.map(t => t.name));

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'content-type, authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

function setCors(res) {
  for (const [k, v] of Object.entries(corsHeaders())) res.setHeader(k, v);
}

// ── JWT verification via Supabase /auth/v1/user ─────────────────────
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
  if (!user || !user.id) return null;
  return user.id;
}

// ── Service-role RPC dispatch ───────────────────────────────────────
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
  const text = await resp.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: resp.ok, status: resp.status, data };
}

async function executeTool(toolName, toolInput, userId) {
  if (!TOOL_NAMES.has(toolName)) {
    return { error: `Unknown tool: ${toolName}` };
  }
  const args = { p_user_id: userId };
  for (const [k, v] of Object.entries(toolInput || {})) {
    if (v === undefined || v === null) continue;
    args[`p_${k}`] = v;
  }
  const { ok, status, data } = await callRPC(toolName, args);
  if (!ok) {
    const message = (data && data.message) || (typeof data === 'string' ? data : `RPC ${toolName} failed (${status})`);
    return { error: message };
  }
  return data;
}

// ── Coaching memory persistence ─────────────────────────────────────
async function persistTurn({ userId, threadId, role, content, turnIndex }) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Vienna' });
  // Direct insert — RLS bypassed via service role.
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
      thread_id: threadId,
      type: 'chat',
      source: 'agentic-chat',
      category: 'chat',
      content,
      turn_index: turnIndex,
      date: today,
    }),
  }).catch(() => {});
}

// ── Anthropic call with tools ───────────────────────────────────────
async function callAnthropic({ model, max_tokens, system, messages }) {
  const resp = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': ANTHROPIC_VERSION,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model, max_tokens, system, messages, tools: TOOLS }),
  });
  const data = await resp.json();
  return { httpStatus: resp.status, data };
}

// ── Handler ─────────────────────────────────────────────────────────
export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const userId = await verifyJWT(req.headers.authorization || req.headers.Authorization);
  if (!userId) return res.status(401).json({ error: 'unauthorized' });

  const body = req.body || {};
  const model = body.model || DEFAULT_MODEL;
  const max_tokens = body.max_tokens || DEFAULT_MAX_TOKENS;
  const system = body.system || '';
  const incomingMessages = Array.isArray(body.messages) ? body.messages.slice() : [];
  const threadId = body.thread_id || null;

  if (incomingMessages.length === 0) {
    return res.status(400).json({ error: 'messages required' });
  }

  const messages = incomingMessages;
  const proposalIds = [];
  const appliedIds = [];
  const dismissedIds = [];
  let iterations = 0;
  let baseTurnIndex = body.turn_index_base || 0;

  // Persist the latest user message immediately so it appears in
  // coaching_memory even if the loop fails downstream. We assume the
  // last incoming message is the user's send.
  const lastIncoming = messages[messages.length - 1];
  if (lastIncoming && lastIncoming.role === 'user' && typeof lastIncoming.content === 'string') {
    await persistTurn({
      userId, threadId, role: 'user', content: lastIncoming.content, turnIndex: baseTurnIndex,
    });
    baseTurnIndex += 1;
  }

  while (iterations < MAX_ITERATIONS) {
    iterations += 1;

    let anthropicResp;
    try {
      anthropicResp = await callAnthropic({ model, max_tokens, system, messages });
    } catch (e) {
      return res.status(500).json({
        error: `anthropic call failed: ${e.message || String(e)}`,
        iterations, thread_id: threadId,
      });
    }

    const { httpStatus, data } = anthropicResp;
    if (httpStatus < 200 || httpStatus >= 300) {
      return res.status(500).json({
        error: `anthropic ${httpStatus}: ${(data && data.error && data.error.message) || JSON.stringify(data).slice(0, 400)}`,
        iterations, thread_id: threadId,
      });
    }

    const blocks = Array.isArray(data.content) ? data.content : [];
    // Record the assistant turn verbatim — tool_use ids must persist
    // so the next user turn's tool_result blocks match correctly.
    messages.push({ role: 'assistant', content: blocks });

    if (data.stop_reason === 'end_turn') {
      const finalText = blocks
        .filter(b => b && b.type === 'text')
        .map(b => b.text || '')
        .join('\n')
        .trim();

      if (finalText) {
        await persistTurn({
          userId, threadId, role: 'assistant',
          content: finalText, turnIndex: baseTurnIndex,
        });
      }

      return res.status(200).json({
        type: 'end_turn',
        assistant: finalText,
        proposal_ids: proposalIds,
        applied_ids: appliedIds,
        dismissed_ids: dismissedIds,
        thread_id: threadId,
        iterations,
      });
    }

    if (data.stop_reason === 'tool_use') {
      const toolUses = blocks.filter(b => b && b.type === 'tool_use');
      if (toolUses.length === 0) {
        return res.status(500).json({
          error: 'tool_use stop_reason but no tool_use blocks',
          iterations, thread_id: threadId,
        });
      }

      const toolResultBlocks = [];
      for (const tu of toolUses) {
        const result = await executeTool(tu.name, tu.input, userId);
        const isError = result && typeof result === 'object' && 'error' in result;

        // Track side effects so the native client can render cards.
        if (!isError && tu.name === 'propose_schedule_change' && result && result.schedule_change_id) {
          proposalIds.push(result.schedule_change_id);
        }
        if (!isError && tu.name === 'apply_schedule_change' && result && result.schedule_change_id) {
          appliedIds.push(result.schedule_change_id);
        }
        if (!isError && tu.name === 'cancel_proposal' && result && result.schedule_change_id) {
          dismissedIds.push(result.schedule_change_id);
        }

        toolResultBlocks.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: typeof result === 'string' ? result : JSON.stringify(result),
          ...(isError ? { is_error: true } : {}),
        });
      }
      messages.push({ role: 'user', content: toolResultBlocks });
      continue;
    }

    return res.status(500).json({
      error: `Unexpected stop_reason: ${data.stop_reason}`,
      iterations, thread_id: threadId,
    });
  }

  return res.status(500).json({
    error: 'Tool-use loop exceeded MAX_ITERATIONS',
    iterations, thread_id: threadId,
    proposal_ids: proposalIds,
  });
}
