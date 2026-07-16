// suunto-auth.js — "Connect Suunto" entry point (Suunto Integration Phase 1).
//
// GET handler. Starts the Suunto Cloud OAuth flow:
//   1. mint a random `state` (CSRF protection for the callback),
//   2. drop it in an httpOnly/Secure/SameSite=Lax cookie (10 min),
//   3. 302-redirect the browser to Suunto's authorize endpoint.
//
// The callback (api/suunto-callback.js) validates the returned `state` against
// this cookie before exchanging the code for tokens. No token handling here.
//
// Suunto authorize (browser GET), per the partner how-to-start doc:
//   {OAUTH_HOST}/oauth/authorize?response_type=code&client_id=...&redirect_uri=...&state=...
// redirect_uri MUST match the token-exchange call byte-for-byte.

import { randomUUID } from 'node:crypto';

export const config = { maxDuration: 10 };

const OAUTH_HOST = 'https://cloudapi-oauth.suunto.com';
const REDIRECT_URI = 'https://athlete-coach-alpha.vercel.app/api/suunto-callback';
const STATE_COOKIE = 'suunto_oauth_state';
const STATE_MAX_AGE = 600; // seconds (10 min)

export default function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).send('Method not allowed');
  }

  const clientId = process.env.SUUNTO_CLIENT_ID;
  if (!clientId) {
    // Misconfiguration — never expose which var, just fail closed.
    return res.status(500).send('Suunto client not configured');
  }

  const state = randomUUID();

  // CSRF cookie: httpOnly (JS can't read it), Secure (HTTPS only),
  // SameSite=Lax (sent on the top-level redirect back from Suunto).
  res.setHeader(
    'Set-Cookie',
    `${STATE_COOKIE}=${state}; Path=/; Max-Age=${STATE_MAX_AGE}; HttpOnly; Secure; SameSite=Lax`
  );

  const authorizeUrl =
    `${OAUTH_HOST}/oauth/authorize` +
    `?response_type=code` +
    `&client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&state=${encodeURIComponent(state)}`;

  res.setHeader('Location', authorizeUrl);
  return res.status(302).end();
}
