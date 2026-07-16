// lib/suunto/tokens.js — Suunto access-token lifecycle (Phase 1 foundation).
//
// getValidSuuntoAccessToken(userId) returns a currently-valid Suunto access
// token for the athlete, refreshing it first if it's within 5 minutes of
// expiry (or already expired). Phase 3 (ingest) will call this before every
// Suunto API request. Nothing calls it yet.
//
// suuntoApiHeaders(accessToken) builds the two-header auth Suunto requires:
// the bearer JWT + the Azure APIM subscription key.
//
// Supabase access uses the repo's REST helper (api/_supabaseRest.js), matching
// the rest of the codebase. Both the Supabase client and the token-endpoint
// fetch are injectable via the optional `deps` arg so the unit tests never hit
// the network.

import { makeSupabaseRest } from '../../api/_supabaseRest.js';

const OAUTH_HOST = 'https://cloudapi-oauth.suunto.com';
const REFRESH_WINDOW_MS = 5 * 60 * 1000; // refresh when <5 min from expiry
const DEFAULT_EXPIRES_IN = 86400; // 24h, per Suunto

/**
 * Error thrown when the athlete has no usable Suunto tokens, or a refresh is
 * rejected (e.g. refresh token revoked). Downstream callers can catch on
 * `err.code === 'SUUNTO_RECONNECT_REQUIRED'` to prompt a reconnect.
 */
function reconnectError(message) {
  const err = new Error(message);
  err.code = 'SUUNTO_RECONNECT_REQUIRED';
  return err;
}

/**
 * Return a valid Suunto access token for `userId`, refreshing if near/at expiry.
 * @param {string} userId
 * @param {{ rest?: object, fetchImpl?: Function }} [deps] - injection for tests
 * @returns {Promise<string>} a valid access token
 * @throws {Error} code 'SUUNTO_RECONNECT_REQUIRED' if not connected / refresh fails
 */
export async function getValidSuuntoAccessToken(userId, deps = {}) {
  const rest = deps.rest || makeSupabaseRest({ fetchImpl: deps.fetchImpl });
  const doFetch = deps.fetchImpl || fetch;

  const rows = await rest.restGet(
    `athlete_settings?user_id=eq.${userId}` +
      `&select=suunto_access_token,suunto_refresh_token,suunto_token_expires_at`
  );
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row || !row.suunto_access_token || !row.suunto_refresh_token) {
    throw reconnectError('Suunto not connected');
  }

  // Still comfortably valid → use as-is (no network call).
  const expiresAtMs = row.suunto_token_expires_at
    ? new Date(row.suunto_token_expires_at).getTime()
    : 0;
  if (expiresAtMs - Date.now() > REFRESH_WINDOW_MS) {
    return row.suunto_access_token;
  }

  // Near/at expiry → refresh.
  const clientId = process.env.SUUNTO_CLIENT_ID;
  const clientSecret = process.env.SUUNTO_CLIENT_SECRET;
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: row.suunto_refresh_token,
  });

  let resp;
  try {
    resp = await doFetch(`${OAUTH_HOST}/oauth/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });
  } catch (err) {
    throw reconnectError(`Suunto token refresh request failed: ${err.message}`);
  }
  if (!resp.ok) {
    // Do not echo the body (may contain sensitive detail). Status only.
    throw reconnectError(`Suunto token refresh rejected (status ${resp.status}) — reconnect required`);
  }

  let data;
  try {
    data = await resp.json();
  } catch {
    throw reconnectError('Suunto token refresh returned a non-JSON response');
  }

  const newAccessToken = data && data.access_token;
  if (!newAccessToken) {
    throw reconnectError('Suunto token refresh returned no access_token — reconnect required');
  }

  const expiresSec = Number.isFinite(data.expires_in) ? data.expires_in : DEFAULT_EXPIRES_IN;
  const patch = {
    suunto_access_token: newAccessToken,
    suunto_token_expires_at: new Date(Date.now() + expiresSec * 1000).toISOString(),
  };
  // Some providers rotate the refresh_token on refresh — persist it if present,
  // otherwise the stored one stays valid.
  if (data.refresh_token) {
    patch.suunto_refresh_token = data.refresh_token;
  }

  await rest.restPatch('athlete_settings', `user_id=eq.${userId}`, patch);
  return newAccessToken;
}

/**
 * Build the auth headers for a Suunto Cloud API request.
 * @param {string} accessToken
 * @returns {{ Authorization: string, 'Ocp-Apim-Subscription-Key': string }}
 */
export function suuntoApiHeaders(accessToken) {
  return {
    // NOTE: Suunto's how-to-start doc writes the Authorization header WITHOUT
    // "Bearer" (just the raw token) — almost certainly a doc typo. We use the
    // standard "Bearer <token>". If a live call returns 401, fall back to the
    // raw token here (`Authorization: accessToken`). This comment marks that spot.
    Authorization: `Bearer ${accessToken}`,
    'Ocp-Apim-Subscription-Key': process.env.SUUNTO_SUBSCRIPTION_KEY,
  };
}
