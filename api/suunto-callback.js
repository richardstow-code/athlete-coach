// suunto-callback.js — OAuth redirect target (Suunto Integration Phase 1).
//
// GET handler. Suunto redirects the browser here after the authorize step:
//   /api/suunto-callback?code=<AUTH_CODE>&state=<STATE>   (or ?error=...)
//
// Flow:
//   1. reject on ?error
//   2. validate ?state against the suunto_oauth_state cookie (CSRF), clear it
//   3. exchange code → tokens (POST {OAUTH_HOST}/oauth/token, Basic auth)
//   4. decode the access_token JWT payload → "user" claim (Suunto username)
//   5. PATCH athlete_settings for the single athlete (NOT upsert); 0 rows ⇒ error
//   6. render a plain success page
//
// Security: tokens go to Supabase only — never logged, never in the URL/HTML.
// Supabase access uses the repo's REST helper (api/_supabaseRest.js), matching
// strava-webhook.js — not @supabase/supabase-js.

import { makeSupabaseRest } from './_supabaseRest.js';
import { decodeJwtPayload } from '../lib/suunto/jwt.js';

export const config = { maxDuration: 10 };

const OAUTH_HOST = 'https://cloudapi-oauth.suunto.com';
// MUST match api/suunto-auth.js byte-for-byte (Suunto compares redirect_uri).
const REDIRECT_URI = 'https://athlete-coach-alpha.vercel.app/api/suunto-callback';
const ATHLETE_USER_ID = '40cfe68e-faea-491c-b410-0093572f02d6';
const STATE_COOKIE = 'suunto_oauth_state';
const DEFAULT_EXPIRES_IN = 86400; // 24h, per Suunto

// ── helpers ──────────────────────────────────────────────────────────────────

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

function readCookie(req, name) {
  const header = req.headers?.cookie || '';
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const k = part.slice(0, eq).trim();
    if (k === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

function clearStateCookie(res) {
  res.setHeader(
    'Set-Cookie',
    `${STATE_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`
  );
}

function page(res, statusCode, title, message, ok) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('X-Frame-Options', 'DENY');
  const accent = ok ? '#14b8a6' : '#dc2626';
  res.status(statusCode).send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  body{font-family:system-ui,sans-serif;max-width:28rem;margin:4rem auto;padding:0 1.25rem;color:#0a0a0a;background:#ffffff}
  .card{border:1px solid #e5e5e5;border-radius:12px;padding:1.75rem;text-align:center}
  h1{font-size:1.25rem;margin:.25rem 0 .75rem;color:${accent}}
  p{color:#444;line-height:1.5;margin:.4rem 0}
</style></head>
<body><div class="card">
  <h1>${esc(title)}</h1>
  <p>${esc(message)}</p>
</div></body></html>`);
}

// ── handler ──────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).send('Method not allowed');
  }

  // The state cookie is single-use — clear it on every callback, success or not.
  const cookieState = readCookie(req, STATE_COOKIE);
  clearStateCookie(res);

  const { code, state, error } = req.query || {};

  // 3a — provider-signalled error (e.g. user denied consent)
  if (error) {
    return page(res, 400, 'Suunto connection failed', `Suunto returned an error: ${error}`, false);
  }

  // 3b — CSRF state validation
  if (!cookieState || !state || state !== cookieState) {
    return page(
      res, 400, 'Security check failed',
      'State mismatch or expired. Please start the Suunto connection again.', false
    );
  }

  if (!code) {
    return page(res, 400, 'Suunto connection failed', 'No authorization code was returned.', false);
  }

  const clientId = process.env.SUUNTO_CLIENT_ID;
  const clientSecret = process.env.SUUNTO_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return page(res, 500, 'Suunto connection failed', 'Server is not configured for Suunto.', false);
  }

  // 3c — exchange the authorization code for tokens
  let tokenData;
  try {
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      redirect_uri: REDIRECT_URI, // must match the authorize call byte-for-byte
      code,
    });
    const tokenRes = await fetch(`${OAUTH_HOST}/oauth/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });
    if (!tokenRes.ok) {
      // Never echo the body — it can contain sensitive detail. Status only.
      console.error(`[suunto-callback] token exchange failed: ${tokenRes.status}`);
      return page(
        res, 502, 'Suunto connection failed',
        `Token exchange failed (status ${tokenRes.status}). Please try again.`, false
      );
    }
    tokenData = await tokenRes.json();
  } catch (err) {
    console.error(`[suunto-callback] token exchange error: ${err.message}`);
    return page(res, 502, 'Suunto connection failed', 'Could not reach Suunto to exchange the code.', false);
  }

  const { access_token, refresh_token, expires_in } = tokenData || {};
  if (!access_token || !refresh_token) {
    console.error('[suunto-callback] token response missing access/refresh token');
    return page(res, 502, 'Suunto connection failed', 'Suunto did not return the expected tokens.', false);
  }

  // 3d — read the Suunto username from the access_token JWT "user" claim
  let username;
  try {
    const payload = decodeJwtPayload(access_token);
    username = payload.user;
    if (!username) throw new Error('no "user" claim in token');
  } catch (err) {
    console.error(`[suunto-callback] could not read user claim: ${err.message}`);
    return page(res, 502, 'Suunto connection failed', 'Could not read the Suunto account from the token.', false);
  }

  // 3e — persist to the single athlete's settings row (PATCH, not upsert)
  const nowIso = new Date().toISOString();
  const expiresSec = Number.isFinite(expires_in) ? expires_in : DEFAULT_EXPIRES_IN;
  const expiresAtIso = new Date(Date.now() + expiresSec * 1000).toISOString();
  try {
    const rest = makeSupabaseRest();
    const rows = await rest.restPatch(
      'athlete_settings',
      `user_id=eq.${ATHLETE_USER_ID}`,
      {
        suunto_username: username,
        suunto_access_token: access_token,
        suunto_refresh_token: refresh_token,
        suunto_token_expires_at: expiresAtIso,
        suunto_connected_at: nowIso,
      }
    );
    if (!Array.isArray(rows) || rows.length === 0) {
      // The settings row should already exist — 0 rows means we wrote nothing.
      console.error('[suunto-callback] athlete_settings update affected 0 rows');
      return page(
        res, 500, 'Suunto connection failed',
        'Connected to Suunto but could not save it to your profile. Please contact support.', false
      );
    }
  } catch (err) {
    console.error(`[suunto-callback] failed to persist tokens: ${err.message}`);
    return page(res, 500, 'Suunto connection failed', 'Could not save your Suunto connection. Please try again.', false);
  }

  // 3f — success
  return page(
    res, 200, 'Suunto connected ✓',
    'You can close this tab and return to the app.', true
  );
}
