// mcp.js — Coach Claude remote MCP server (Phase 1, read-only).
//
// Vercel Node serverless route, stateless MCP Streamable-HTTP transport (a new
// server+transport per request — no session state, fits serverless and the
// 30s maxDuration). Exposes the seven read-only tools from _mcpTools.js, each
// hard-scoped to the single athlete (ATHLETE_USER_ID). Tools RETURN { error },
// never throw raw. Host/secret conventions mirror api/claude-proxy.js.
//
// AUTH (single-user v1, NOT multi-tenant): require Authorization: Bearer <t>
// where <t> equals MCP_SHARED_SECRET (set in Vercel + the MCP client config),
// or is a valid Supabase user JWT. The service-role key never leaves the
// server. No per-user scoping yet (Phase 1 is one athlete).

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { makeSupabaseRest } from './_supabaseRest.js';
import { TOOLS, ATHLETE_USER_ID } from './_mcpTools.js';
import { validateOAuthToken } from './_oauth.js';

export const config = { maxDuration: 30 };

const SUPABASE_URL = 'https://yjuhzmknabedjklsgbje.supabase.co';

// Zod input shapes (kept here so _mcpTools.js stays dependency-free).
const SHAPES = {
  get_athlete_profile: {},
  get_recent_activities: {
    from: z.string().describe('Vienna start date YYYY-MM-DD (default 14 days ago)').optional(),
    to: z.string().describe('Vienna end date YYYY-MM-DD (default today)').optional(),
    limit: z.number().int().describe('max rows, default 50').optional(),
  },
  get_activity_detail: {
    activity_id: z.number().int().describe('activities.id'),
  },
  get_scheduled_sessions: {
    from: z.string().describe('Vienna start date YYYY-MM-DD (default today)').optional(),
    to: z.string().describe('Vienna end date YYYY-MM-DD (default +7 days)').optional(),
    statuses: z
      .array(z.string())
      .describe("subset of planned|completed|missed|completed_different|rest_observed|superseded, or ['all']")
      .optional(),
  },
  get_training_zones: {},
  get_recovery: {},
  get_coaching_memory: {
    type: z.string().optional(),
    category: z.string().optional(),
    from: z.string().describe('date YYYY-MM-DD').optional(),
    to: z.string().describe('date YYYY-MM-DD').optional(),
    limit: z.number().int().describe('max rows, default 10').optional(),
  },
  // ── Phase 2 reads ──
  get_nutrition: {
    from: z.string().describe('Vienna start date YYYY-MM-DD (default 7 days ago)').optional(),
    to: z.string().describe('Vienna end date YYYY-MM-DD (default today)').optional(),
  },
  get_weekly_review: {},
  get_routes: {
    route_id: z.string().describe('athlete_routes.id (uuid) — returns that route\'s coaching context').optional(),
    session_type: z.string().optional(),
    limit: z.number().int().describe('max routes when listing, default 10').optional(),
  },
  // ── Phase 2 writes (propose-by-default; commit:true required to mutate) ──
  log_session_feedback: {
    activity_id: z.number().int().describe('activities.id'),
    rpe: z
      .number()
      .int()
      .describe(
        "The athlete's OWN raw RPE, integer 1-10 (never a computed feel_score). VERBATIM-ONLY: include only if the athlete stated it. Never infer or estimate it from HR, pace, splits, distance or duration. Omit if not provided."
      )
      .optional(),
    feel_legs: z
      .string()
      .describe(
        "The athlete's OWN words for how their legs felt (e.g. normal / heavy / fresh). VERBATIM-ONLY: never infer from metrics. Omit if the athlete did not say."
      )
      .optional(),
    injury_flag: z
      .string()
      .describe(
        "The athlete's OWN injury report (e.g. nothing / left-knee niggle). VERBATIM-ONLY: never infer from metrics. Omit if the athlete did not say."
      )
      .optional(),
    notes: z
      .string()
      .describe(
        "The athlete's OWN verbatim note about the session, in their words (writes to the subjective_notes column). VERBATIM-ONLY: NEVER summarise the activity or write a third-person metrics recap (distance / pace / HR / 'negative-split finish' etc.). Omit if the athlete gave no note — an omitted note never overwrites the existing one."
      )
      .optional(),
    commit: z
      .boolean()
      .describe(
        'must be true to write; otherwise returns the proposed diff. With no athlete-provided subjective field the tool refuses and writes nothing.'
      )
      .optional(),
  },
  propose_schedule_change: {
    change_type: z.string().describe('reschedule|skip|intensity_adjust|add_session|adjust|...'),
    title: z.string().describe('required (schedule_changes.title is NOT NULL)'),
    reasoning: z.string().describe('required (schedule_changes.reasoning is NOT NULL)'),
    original_session_id: z.number().int().optional(),
    new_date: z.string().optional(),
    new_name: z.string().optional(),
    new_notes: z.string().optional(),
    new_intensity: z.string().optional(),
    new_duration_low: z.number().int().optional(),
    new_duration_high: z.number().int().optional(),
    proposed_session: z.record(z.string(), z.any()).optional(),
    context: z.any().optional(),
    commit: z.boolean().describe('must be true to write the pending row').optional(),
  },
  write_coaching_memory: {
    source: z.string().describe('part of the unique key (user_id,date,source)'),
    content: z.string(),
    date: z.string().describe('YYYY-MM-DD (default today, Vienna)').optional(),
    type: z.string().optional(),
    category: z.string().optional(),
    commit: z.boolean().describe('must be true to upsert').optional(),
  },
  update_athlete_profile: {
    weight_kg: z.number().optional(),
    goal_type: z.string().optional(),
    health_notes: z.string().optional(),
    commit: z.boolean().describe('must be true to write; confirm each field first').optional(),
  },
};

// Build a fresh McpServer with all tools bound to a given Supabase client.
// Exported for unit testing the wiring without standing up the HTTP transport.
export function buildServer(client) {
  const server = new McpServer({ name: 'coach-claude-mcp', version: '1.0.0' });
  for (const t of TOOLS) {
    server.registerTool(
      t.name,
      { description: t.description, inputSchema: SHAPES[t.name] || {} },
      async (args) => {
        const result = await t.fn(client, args || {}, { userId: ATHLETE_USER_ID });
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          isError: !!(result && result.error),
        };
      }
    );
  }
  return server;
}

// Canonical resource + its RFC 9728 metadata URL (Path B / OAuth discovery).
const RESOURCE_URL = 'https://athlete-coach-alpha.vercel.app/api/mcp';
const RESOURCE_METADATA_URL =
  'https://athlete-coach-alpha.vercel.app/.well-known/oauth-protected-resource';

function corsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization, mcp-session-id, mcp-protocol-version');
}

// Legacy Supabase-JWT introspection (CC/Desktop/API path — works for HS256
// session tokens not in the JWKS). Unchanged behaviour.
async function verifyJWT(jwt) {
  const resp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: process.env.SUPABASE_SECRET_KEY, Authorization: `Bearer ${jwt}` },
  });
  if (!resp.ok) return null;
  const user = await resp.json().catch(() => null);
  return user?.id || null;
}

// Decide whether a request is authorized. THREE accepted paths (single athlete):
//   1. shared_secret  — Bearer === MCP_SHARED_SECRET (CC/Desktop/API)
//   2. oauth          — OAuth 2.1 access token validated via Supabase JWKS
//                       (web/mobile connector) — ruling #1
//   3. supabase_jwt   — legacy Supabase session JWT via remote introspection
// Exported + dependency-injectable for unit tests. Returns { ok, via, userId? }.
export async function authorizeRequest(authHeader, deps = {}) {
  const checkOAuth = deps.validateOAuthToken || validateOAuthToken;
  const introspect = deps.verifyJWT || verifyJWT;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return { ok: false };
  const token = authHeader.slice(7).trim();
  if (!token) return { ok: false };

  const secret = process.env.MCP_SHARED_SECRET;
  if (secret && token === secret) return { ok: true, via: 'shared_secret' };

  const oauth = await checkOAuth(token);
  if (oauth.ok) return { ok: true, via: 'oauth', userId: oauth.userId, clientId: oauth.clientId };

  const uid = await introspect(token);
  if (uid && uid === ATHLETE_USER_ID) return { ok: true, via: 'supabase_jwt', userId: uid };

  return { ok: false };
}

function unauthorized(res) {
  // RFC 9728 §5.1: point the client at the protected-resource metadata so the
  // web/mobile connector can discover the authorization server and start OAuth.
  res.setHeader('WWW-Authenticate', `Bearer resource_metadata="${RESOURCE_METADATA_URL}"`);
  return res
    .status(401)
    .json({ jsonrpc: '2.0', error: { code: -32001, message: 'unauthorized' }, id: null });
}

export default async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res
      .status(405)
      .json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null });
  }

  const authHeader = req.headers.authorization || req.headers.Authorization || '';
  const auth = await authorizeRequest(authHeader);
  if (!auth.ok) return unauthorized(res);

  const client = makeSupabaseRest({}); // env-wired: prod URL + SUPABASE_SECRET_KEY
  const server = buildServer(client);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => {
    transport.close();
    server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    if (!res.headersSent) {
      res
        .status(500)
        .json({ jsonrpc: '2.0', error: { code: -32603, message: `internal error: ${e.message}` }, id: null });
    }
  }
}
