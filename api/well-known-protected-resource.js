// well-known-protected-resource.js — RFC 9728 OAuth 2.0 Protected Resource
// Metadata for the MCP server. Served (via vercel.json rewrites) at
//   /.well-known/oauth-protected-resource
//   /.well-known/oauth-protected-resource/api/mcp
// It points MCP clients at the Supabase OAuth 2.1 authorization server; the
// client then fetches that AS's metadata and runs the OAuth 2.1 + PKCE flow.

export const config = { maxDuration: 10 };

const RESOURCE_URL = 'https://athlete-coach-alpha.vercel.app/api/mcp';
const SUPABASE_ISSUER = 'https://yjuhzmknabedjklsgbje.supabase.co/auth/v1';

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  return res.status(200).json({
    resource: RESOURCE_URL,
    // The Supabase OAuth 2.1 server is the authorization server. Clients derive
    // its metadata URL (RFC 8414 path-aware) from this issuer:
    // https://<ref>.supabase.co/.well-known/oauth-authorization-server/auth/v1
    authorization_servers: [SUPABASE_ISSUER],
    bearer_methods_supported: ['header'],
    scopes_supported: ['openid', 'profile', 'email'],
    resource_documentation: 'https://athlete-coach-alpha.vercel.app/docs/mcp',
  });
}
