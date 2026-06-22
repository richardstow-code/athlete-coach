// mcp-oauth.test.js — GATE tests for Path B (OAuth for the web/mobile connector).
// Auth-layer only; tool behaviour unchanged. No network (jose verify is injected).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateOAuthToken, SUPABASE_ISSUER } from '../../api/_oauth.js';
import { authorizeRequest } from '../../api/mcp.js';
import prmHandler from '../../api/well-known-protected-resource.js';
import mcpHandler from '../../api/mcp.js';
import { ATHLETE_USER_ID } from '../../api/_mcpTools.js';

function fakeRes() {
  return {
    headers: {}, statusCode: null, body: null, ended: false,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(c) { this.statusCode = c; return this; },
    json(o) { this.body = o; return this; },
    end() { this.ended = true; return this; },
    send(s) { this.body = s; return this; },
  };
}

// ── validateOAuthToken (ruling #1: sig/exp/iss via jose + aud + sub) ──────────

test('validateOAuthToken accepts a well-formed Supabase OAuth token', async () => {
  const verify = async () => ({ payload: { aud: 'authenticated', sub: ATHLETE_USER_ID, client_id: 'claude-xyz', scope: 'openid profile' } });
  const r = await validateOAuthToken('tok', { verify });
  assert.equal(r.ok, true);
  assert.equal(r.userId, ATHLETE_USER_ID);
  assert.equal(r.clientId, 'claude-xyz');
});

test('validateOAuthToken rejects wrong aud', async () => {
  const verify = async () => ({ payload: { aud: 'something-else', sub: ATHLETE_USER_ID } });
  const r = await validateOAuthToken('tok', { verify });
  assert.equal(r.ok, false);
  assert.match(r.error, /aud/);
});

test('validateOAuthToken rejects a token for another subject (single-user binding)', async () => {
  const verify = async () => ({ payload: { aud: 'authenticated', sub: 'someone-else' } });
  const r = await validateOAuthToken('tok', { verify });
  assert.equal(r.ok, false);
  assert.match(r.error, /subject/);
});

test('validateOAuthToken rejects an invalid/expired token (verify throws)', async () => {
  const verify = async () => { throw new Error('"exp" claim timestamp check failed'); };
  const r = await validateOAuthToken('tok', { verify });
  assert.equal(r.ok, false);
  assert.match(r.error, /exp/);
});

test('aud may be an array containing "authenticated"', async () => {
  const verify = async () => ({ payload: { aud: ['authenticated', 'x'], sub: ATHLETE_USER_ID } });
  assert.equal((await validateOAuthToken('t', { verify })).ok, true);
});

// ── authorizeRequest (three paths) ───────────────────────────────────────────

test('authorizeRequest: shared_secret path (CC/Desktop/API) still works', async () => {
  process.env.MCP_SHARED_SECRET = 'sekret';
  try {
    const r = await authorizeRequest('Bearer sekret', {
      validateOAuthToken: async () => ({ ok: false }),
      verifyJWT: async () => null,
    });
    assert.deepEqual(r, { ok: true, via: 'shared_secret' });
  } finally { delete process.env.MCP_SHARED_SECRET; }
});

test('authorizeRequest: oauth path accepted via validateOAuthToken', async () => {
  const r = await authorizeRequest('Bearer abc', {
    validateOAuthToken: async () => ({ ok: true, userId: ATHLETE_USER_ID, clientId: 'c1' }),
    verifyJWT: async () => null,
  });
  assert.equal(r.ok, true);
  assert.equal(r.via, 'oauth');
  assert.equal(r.userId, ATHLETE_USER_ID);
});

test('authorizeRequest: REGRESSION legacy Supabase-JWT introspection path', async () => {
  const r = await authorizeRequest('Bearer jwt', {
    validateOAuthToken: async () => ({ ok: false }),
    verifyJWT: async () => ATHLETE_USER_ID,
  });
  assert.equal(r.ok, true);
  assert.equal(r.via, 'supabase_jwt');
});

test('authorizeRequest: a JWT for a different user is rejected (single-user)', async () => {
  const r = await authorizeRequest('Bearer jwt', {
    validateOAuthToken: async () => ({ ok: false }),
    verifyJWT: async () => 'different-user-id',
  });
  assert.equal(r.ok, false);
});

test('authorizeRequest: no/blank/non-bearer header is rejected', async () => {
  const noop = { validateOAuthToken: async () => ({ ok: false }), verifyJWT: async () => null };
  assert.equal((await authorizeRequest('', noop)).ok, false);
  assert.equal((await authorizeRequest('Bearer ', noop)).ok, false);
  assert.equal((await authorizeRequest('Basic xyz', noop)).ok, false);
});

// ── discovery endpoints ──────────────────────────────────────────────────────

test('protected-resource metadata returns valid RFC 9728 JSON', () => {
  const res = fakeRes();
  prmHandler({ method: 'GET' }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.resource, 'https://athlete-coach-alpha.vercel.app/api/mcp');
  assert.deepEqual(res.body.authorization_servers, [SUPABASE_ISSUER]);
});

test('unauthenticated MCP request returns 401 WITH WWW-Authenticate resource_metadata', async () => {
  const res = fakeRes();
  await mcpHandler({ method: 'POST', headers: {}, body: {} }, res);
  assert.equal(res.statusCode, 401);
  assert.match(res.headers['www-authenticate'], /^Bearer resource_metadata="https:\/\/athlete-coach-alpha\.vercel\.app\/\.well-known\/oauth-protected-resource"$/);
});

test('OPTIONS preflight short-circuits 200', async () => {
  const res = fakeRes();
  await mcpHandler({ method: 'OPTIONS', headers: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.ended, true);
});
