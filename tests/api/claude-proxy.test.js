/**
 * API tests: Vercel claude-proxy route
 *
 * Tier: @minor
 *
 * Tests against the live Vercel deployment.
 * Set VERCEL_DEPLOYMENT_URL in tests/.env.test to override
 * (defaults to https://athlete-coach-alpha.vercel.app).
 *
 * No real Anthropic calls are made — the payload tests use
 * an intentionally invalid model name to get a 400-class error
 * from the Anthropic API, confirming the proxy is routing correctly.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { config } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: join(__dirname, '../.env.test') })

const BASE = (process.env.VERCEL_DEPLOYMENT_URL ?? 'https://athlete-coach-alpha.vercel.app').replace(/\/$/, '')
const PROXY_URL = `${BASE}/api/claude-proxy`

// ── Test 1: GET → 405 ────────────────────────────────────────────────────────

test('@minor claude-proxy: GET returns 405', async () => {
  const res = await fetch(PROXY_URL, { method: 'GET' })
  assert.equal(res.status, 405, `Expected 405 Method Not Allowed, got ${res.status}`)
  const body = await res.json()
  assert.ok(body.error, 'Response should include an error field')
})

// ── Test 2: POST with invalid model → proxy routes to Anthropic and returns ──

test('@minor claude-proxy: POST routes to Anthropic (error response shape)', async () => {
  const res = await fetch(PROXY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-ci-test-nonexistent-model',
      max_tokens: 10,
      messages: [{ role: 'user', content: 'ping' }],
    }),
  })

  // The proxy should always return 200 (it wraps errors in the response body)
  assert.equal(res.status, 200, `Proxy should return 200 even on upstream error, got ${res.status}`)

  const data = await res.json()
  // Either a valid response shape or an error object — both indicate the proxy reached Anthropic
  assert.ok(
    data.type === 'error' || data.id || data._status,
    `Response must have type/id/_status — got: ${JSON.stringify(data).slice(0, 200)}`
  )
})

// ── Test 3: CORS headers present ────────────────────────────────────────────

test('@minor claude-proxy: CORS header present on POST', async () => {
  const res = await fetch(PROXY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'test', max_tokens: 1, messages: [] }),
  })
  const cors = res.headers.get('access-control-allow-origin')
  assert.ok(cors, 'Access-Control-Allow-Origin header must be present')
})

// ── Test 4: OPTIONS preflight → 200 ─────────────────────────────────────────

test('@minor claude-proxy: OPTIONS preflight returns 200', async () => {
  const res = await fetch(PROXY_URL, {
    method: 'OPTIONS',
    headers: { 'Access-Control-Request-Method': 'POST' },
  })
  assert.ok(
    res.status === 200 || res.status === 204,
    `OPTIONS should return 200/204, got ${res.status}`
  )
})
