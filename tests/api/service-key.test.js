/**
 * Unit tests: api/_serviceKey.js (W0-D2, #20)
 *
 * Tier: @smoke
 *
 * Legacy service_role JWTs ride on apikey + Bearer; sb_secret_ keys go on
 * apikey only. No network.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { serviceKeyHeaders } from '../../api/_serviceKey.js'

test('@smoke serviceKeyHeaders: legacy JWT key is also sent as Bearer', () => {
  assert.deepEqual(serviceKeyHeaders('eyJfake.payload.sig'), {
    apikey: 'eyJfake.payload.sig',
    Authorization: 'Bearer eyJfake.payload.sig',
  })
})

test('@smoke serviceKeyHeaders: sb_secret_ key goes on apikey only', () => {
  assert.deepEqual(serviceKeyHeaders('sb_secret_fake'), { apikey: 'sb_secret_fake' })
})

test('@smoke serviceKeyHeaders: defaults to SUPABASE_SECRET_KEY', () => {
  const before = process.env.SUPABASE_SECRET_KEY
  process.env.SUPABASE_SECRET_KEY = 'sb_secret_env'
  try {
    assert.deepEqual(serviceKeyHeaders(), { apikey: 'sb_secret_env' })
  } finally {
    if (before === undefined) delete process.env.SUPABASE_SECRET_KEY
    else process.env.SUPABASE_SECRET_KEY = before
  }
})
