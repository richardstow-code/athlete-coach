/**
 * Unit tests: lib/suunto/tokens.js — getValidSuuntoAccessToken + suuntoApiHeaders
 *
 * Tier: @minor
 * Pure unit test — Supabase REST and the token endpoint are injected/mocked,
 * no network. (STEP 5b)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getValidSuuntoAccessToken, suuntoApiHeaders } from '../../lib/suunto/tokens.js'

const USER = '40cfe68e-faea-491c-b410-0093572f02d6'
const iso = (msFromNow) => new Date(Date.now() + msFromNow).toISOString()

// A fake makeSupabaseRest-shaped client with a preloaded row + captured patch.
function fakeRest(row) {
  const state = { patched: null, getCalls: 0 }
  return {
    state,
    restGet: async () => { state.getCalls++; return row ? [row] : [] },
    restPatch: async (_table, _query, body) => { state.patched = body; return [body] },
  }
}

test('@minor suunto tokens: token far from expiry returns existing token, no refresh', async () => {
  const rest = fakeRest({
    suunto_access_token: 'STILL_VALID',
    suunto_refresh_token: 'R1',
    suunto_token_expires_at: iso(60 * 60 * 1000), // +1h
  })
  let fetchCalled = false
  const token = await getValidSuuntoAccessToken(USER, {
    rest,
    fetchImpl: async () => { fetchCalled = true },
  })
  assert.equal(token, 'STILL_VALID')
  assert.equal(fetchCalled, false, 'must not call the token endpoint when still valid')
  assert.equal(rest.state.patched, null, 'must not write when still valid')
})

test('@minor suunto tokens: token near expiry triggers refresh, stores + returns new token', async () => {
  process.env.SUUNTO_CLIENT_ID = 'id'
  process.env.SUUNTO_CLIENT_SECRET = 'secret'
  const rest = fakeRest({
    suunto_access_token: 'OLD',
    suunto_refresh_token: 'R1',
    suunto_token_expires_at: iso(60 * 1000), // +60s, inside the 5-min window
  })
  const fetchImpl = async (url, opts) => {
    assert.ok(String(url).endsWith('/oauth/token'), 'refresh should hit the token endpoint')
    assert.match(opts.body, /grant_type=refresh_token/)
    assert.match(opts.body, /refresh_token=R1/)
    return { ok: true, json: async () => ({ access_token: 'NEW', expires_in: 86400 }) }
  }
  const token = await getValidSuuntoAccessToken(USER, { rest, fetchImpl })
  assert.equal(token, 'NEW')
  assert.equal(rest.state.patched.suunto_access_token, 'NEW')
  assert.ok(rest.state.patched.suunto_token_expires_at, 'must persist a new expiry')
  const delta = new Date(rest.state.patched.suunto_token_expires_at).getTime() - Date.now()
  assert.ok(Math.abs(delta - 86400 * 1000) < 5000, 'new expiry ~ now + 86400s')
})

test('@minor suunto tokens: rotated refresh_token in response is persisted', async () => {
  process.env.SUUNTO_CLIENT_ID = 'id'
  process.env.SUUNTO_CLIENT_SECRET = 'secret'
  const rest = fakeRest({
    suunto_access_token: 'OLD',
    suunto_refresh_token: 'R1',
    suunto_token_expires_at: iso(-1000), // already expired
  })
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({ access_token: 'NEW', refresh_token: 'R2', expires_in: 86400 }),
  })
  await getValidSuuntoAccessToken(USER, { rest, fetchImpl })
  assert.equal(rest.state.patched.suunto_refresh_token, 'R2', 'rotated refresh token must be stored')
})

test('@minor suunto tokens: no rotation → refresh_token field is not overwritten', async () => {
  process.env.SUUNTO_CLIENT_ID = 'id'
  process.env.SUUNTO_CLIENT_SECRET = 'secret'
  const rest = fakeRest({
    suunto_access_token: 'OLD',
    suunto_refresh_token: 'R1',
    suunto_token_expires_at: iso(-1000),
  })
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({ access_token: 'NEW', expires_in: 86400 }), // no refresh_token
  })
  await getValidSuuntoAccessToken(USER, { rest, fetchImpl })
  assert.equal('suunto_refresh_token' in rest.state.patched, false, 'must not touch refresh_token when none returned')
})

test('@minor suunto tokens: missing tokens throws "not connected" (reconnect code)', async () => {
  const rest = fakeRest(null) // no row
  await assert.rejects(
    () => getValidSuuntoAccessToken(USER, { rest }),
    (e) => e.message === 'Suunto not connected' && e.code === 'SUUNTO_RECONNECT_REQUIRED'
  )
})

test('@minor suunto tokens: refresh rejection throws reconnect-required error', async () => {
  process.env.SUUNTO_CLIENT_ID = 'id'
  process.env.SUUNTO_CLIENT_SECRET = 'secret'
  const rest = fakeRest({
    suunto_access_token: 'OLD',
    suunto_refresh_token: 'REVOKED',
    suunto_token_expires_at: iso(-1000),
  })
  const fetchImpl = async () => ({ ok: false, status: 400, json: async () => ({}) })
  await assert.rejects(
    () => getValidSuuntoAccessToken(USER, { rest, fetchImpl }),
    (e) => e.code === 'SUUNTO_RECONNECT_REQUIRED' && /status 400/.test(e.message)
  )
})

test('@minor suunto tokens: suuntoApiHeaders builds bearer + subscription-key headers', () => {
  process.env.SUUNTO_SUBSCRIPTION_KEY = 'subkey123'
  const h = suuntoApiHeaders('ACCESS')
  assert.equal(h.Authorization, 'Bearer ACCESS')
  assert.equal(h['Ocp-Apim-Subscription-Key'], 'subkey123')
})
