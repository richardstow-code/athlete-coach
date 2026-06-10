/**
 * API tests: Vercel regenerate-coaching-artifact route (B1, Option 1)
 *
 * Tier: @minor
 *
 * Tests against the live Vercel deployment (same convention as
 * claude-proxy.test.js / analyze-activity.test.js). These cover the
 * method + shared-secret + contract GATES. No real Anthropic calls are
 * made.
 *
 * The deeper "a real source change regenerates the take and the row
 * ACTUALLY CHANGED" assertion is the architect's post-deploy end-to-end
 * verification (deploy-order step 4) — it needs the source-change trigger
 * + a live activity, neither of which exists in this repo's test tier.
 *
 * Set VERCEL_DEPLOYMENT_URL in tests/.env.test to override the base.
 * If ANALYZE_ACTIVITY_SECRET is present in tests/.env.test, the
 * secret-gated contract assertions also run.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { config } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: join(__dirname, '../.env.test') })

const BASE = (process.env.VERCEL_DEPLOYMENT_URL ?? 'https://athlete-coach-alpha.vercel.app').replace(/\/$/, '')
const URL = `${BASE}/api/regenerate-coaching-artifact`
const SECRET = process.env.ANALYZE_ACTIVITY_SECRET

// ── Method gate ──────────────────────────────────────────────────────────────

test('@minor regen: GET returns 405', async () => {
  const res = await fetch(URL, { method: 'GET' })
  assert.equal(res.status, 405, `Expected 405, got ${res.status}`)
})

test('@minor regen: OPTIONS preflight returns 200', async () => {
  const res = await fetch(URL, { method: 'OPTIONS' })
  assert.equal(res.status, 200, `Expected 200 for OPTIONS, got ${res.status}`)
})

// ── Shared-secret gate (mirrors analyze-activity) ────────────────────────────

test('@minor regen: POST without secret returns 401', async () => {
  const res = await fetch(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ artifact: 'coach_take', activity_id: 1 }),
  })
  assert.equal(res.status, 401, `Expected 401 without secret, got ${res.status}`)
})

test('@minor regen: POST with wrong secret returns 401', async () => {
  const res = await fetch(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-analyze-secret': 'definitely-not-the-secret' },
    body: JSON.stringify({ artifact: 'coach_take', activity_id: 1 }),
  })
  assert.equal(res.status, 401, `Expected 401 with wrong secret, got ${res.status}`)
})

// ── Contract gate (secret-gated — only runs if the real secret is available) ─

test('@minor regen: briefing artifact is rejected (client-driven)', async (t) => {
  if (!SECRET) return t.skip('ANALYZE_ACTIVITY_SECRET not set in tests/.env.test')
  const res = await fetch(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-analyze-secret': SECRET },
    body: JSON.stringify({ artifact: 'morning_briefing', activity_id: null }),
  })
  assert.equal(res.status, 400, `Expected 400 for morning_briefing, got ${res.status}`)
  const body = await res.json()
  assert.match(body.error ?? '', /client-driven/i, 'error should explain briefing is client-driven')
})

test('@minor regen: coach_take without activity_id returns 400', async (t) => {
  if (!SECRET) return t.skip('ANALYZE_ACTIVITY_SECRET not set in tests/.env.test')
  const res = await fetch(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-analyze-secret': SECRET },
    body: JSON.stringify({ artifact: 'coach_take' }),
  })
  assert.equal(res.status, 400, `Expected 400 without activity_id, got ${res.status}`)
})
