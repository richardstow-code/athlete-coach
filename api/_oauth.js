// _oauth.js — validate an OAuth 2.1 access token issued by the Supabase OAuth
// 2.1 server (Path B, web/mobile connector). Per Architect ruling #1 this is a
// documented single-user deviation from the MCP spec's resource-bound-audience
// MUST: Supabase issues aud="authenticated" (no RFC 8707 resource indicator),
// so we instead validate signature+expiry+issuer+aud AND bind to the single
// athlete via sub === ATHLETE_USER_ID. Revisit (resource-bound tokens / option c)
// if this ever becomes multi-user or serves multiple distinct resource servers.

import { createRemoteJWKSet, jwtVerify } from 'jose';
import { ATHLETE_USER_ID } from './_mcpTools.js';

const SUPABASE_URL = 'https://yjuhzmknabedjklsgbje.supabase.co';
export const SUPABASE_ISSUER = `${SUPABASE_URL}/auth/v1`;
const JWKS_URL = `${SUPABASE_ISSUER}/.well-known/jwks.json`;
const EXPECTED_AUD = process.env.MCP_OAUTH_AUD || 'authenticated';

let _jwks;
function jwks() {
  if (!_jwks) _jwks = createRemoteJWKSet(new URL(JWKS_URL));
  return _jwks;
}

function audMatches(aud, expected) {
  return Array.isArray(aud) ? aud.includes(expected) : aud === expected;
}

// Returns { ok, userId, clientId, scope } or { ok:false, error }.
// opts.verify lets tests inject a verifier (avoids network/crypto).
export async function validateOAuthToken(token, opts = {}) {
  if (!token) return { ok: false, error: 'no token' };
  const issuer = opts.issuer || SUPABASE_ISSUER;
  const expectedAud = opts.expectedAud || EXPECTED_AUD;
  const expectedSub = opts.expectedSub || ATHLETE_USER_ID;
  const verify = opts.verify || ((t) => jwtVerify(t, jwks(), { issuer }));
  try {
    const { payload } = await verify(token); // checks signature, exp, nbf, iss
    if (!audMatches(payload.aud, expectedAud)) {
      return { ok: false, error: `aud mismatch (expected ${expectedAud})` };
    }
    if (payload.sub !== expectedSub) {
      return { ok: false, error: 'token subject is not the single athlete' };
    }
    const clientId = payload.client_id || payload.azp || payload.cid || null;
    return { ok: true, userId: payload.sub, clientId, scope: payload.scope || null };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
