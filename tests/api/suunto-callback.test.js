/**
 * Unit test: api/suunto-callback.js — token-exchange parsing + persistence
 *
 * Tier: @minor
 * Drives the real handler with a stubbed global fetch (Suunto token endpoint +
 * Supabase REST) and fake req/res. No network. (STEP 5a)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import handler from '../../api/suunto-callback.js'

const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url')
const makeJwt = (payload) => `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}.sig`

function mockRes() {
  return {
    statusCode: null,
    headers: {},
    body: null,
    setHeader(k, v) { this.headers[k] = v },
    status(c) { this.statusCode = c; return this },
    send(b) { this.body = b; return this },
    json(o) { this.body = o; return this },
    end() { return this },
  }
}

test('@minor suunto callback: extracts user claim and computes expiry = now + 86400s', async () => {
  process.env.SUUNTO_CLIENT_ID = 'id'
  process.env.SUUNTO_CLIENT_SECRET = 'secret'
  process.env.SUPABASE_SECRET_KEY = 'svc'

  const STATE = 'state-123'
  const accessJwt = makeJwt({ user: 'testuser', scope: 'workout' })
  let patchBody = null

  const realFetch = globalThis.fetch
  globalThis.fetch = async (url, opts) => {
    const u = String(url)
    if (u.includes('/oauth/token')) {
      // assert the exchange request shape
      assert.match(opts.headers.Authorization, /^Basic /)
      assert.match(opts.body, /grant_type=authorization_code/)
      assert.match(opts.body, /code=THE_CODE/)
      return {
        ok: true,
        json: async () => ({
          access_token: accessJwt,
          refresh_token: 'R1',
          token_type: 'bearer',
          expires_in: 86400,
          scope: 'workout',
        }),
      }
    }
    if (u.includes('/rest/v1/athlete_settings')) {
      patchBody = JSON.parse(opts.body)
      return { ok: true, json: async () => [{ user_id: '40cfe68e-faea-491c-b410-0093572f02d6' }] }
    }
    throw new Error(`unexpected fetch to ${u}`)
  }

  try {
    const req = {
      method: 'GET',
      query: { code: 'THE_CODE', state: STATE },
      headers: { cookie: `suunto_oauth_state=${STATE}` },
    }
    const res = mockRes()
    await handler(req, res)

    assert.equal(res.statusCode, 200, 'should render success')
    assert.match(String(res.body), /Suunto connected/)

    // the two things the brief asks 5a to assert:
    assert.equal(patchBody.suunto_username, 'testuser', 'user claim extracted')
    const delta = new Date(patchBody.suunto_token_expires_at).getTime() - Date.now()
    assert.ok(Math.abs(delta - 86400 * 1000) < 5000, 'expires_at ~ now + 86400s')

    // sanity: tokens persisted, connected_at stamped
    assert.equal(patchBody.suunto_access_token, accessJwt)
    assert.equal(patchBody.suunto_refresh_token, 'R1')
    assert.ok(patchBody.suunto_connected_at)
  } finally {
    globalThis.fetch = realFetch
  }
})

test('@minor suunto callback: state mismatch is rejected before any token exchange', async () => {
  const realFetch = globalThis.fetch
  let fetched = false
  globalThis.fetch = async () => { fetched = true; return { ok: true, json: async () => ({}) } }
  try {
    const req = {
      method: 'GET',
      query: { code: 'THE_CODE', state: 'attacker-state' },
      headers: { cookie: 'suunto_oauth_state=real-state' },
    }
    const res = mockRes()
    await handler(req, res)
    assert.equal(res.statusCode, 400)
    assert.match(String(res.body), /Security check failed/)
    assert.equal(fetched, false, 'must not exchange the code when state is invalid')
  } finally {
    globalThis.fetch = realFetch
  }
})
