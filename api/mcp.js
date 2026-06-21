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

function corsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization, mcp-session-id, mcp-protocol-version');
}

async function verifyJWT(jwt) {
  const resp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: process.env.SUPABASE_SECRET_KEY, Authorization: `Bearer ${jwt}` },
  });
  if (!resp.ok) return null;
  const user = await resp.json().catch(() => null);
  return user?.id || null;
}

async function authorize(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return false;
  const token = authHeader.slice(7).trim();
  if (!token) return false;
  const secret = process.env.MCP_SHARED_SECRET;
  if (secret && token === secret) return true;
  const uid = await verifyJWT(token);
  return !!uid;
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
  if (!(await authorize(authHeader))) {
    return res
      .status(401)
      .json({ jsonrpc: '2.0', error: { code: -32001, message: 'unauthorized' }, id: null });
  }

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
