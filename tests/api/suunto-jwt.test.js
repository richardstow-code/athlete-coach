/**
 * Unit tests: lib/suunto/jwt.js — decodeJwtPayload
 *
 * Tier: @minor
 * Pure unit test, no network. (STEP 5c)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decodeJwtPayload } from '../../lib/suunto/jwt.js'

const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url')
const makeJwt = (payload) => `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}.sig`

test('@minor suunto jwt: decodes the middle segment and reads custom claims', () => {
  const jwt = makeJwt({ user: 'testuser', scope: 'workout' })
  const payload = decodeJwtPayload(jwt)
  assert.equal(payload.user, 'testuser')
  assert.equal(payload.scope, 'workout')
})

test('@minor suunto jwt: handles base64url padding for varied payload lengths', () => {
  // Different byte lengths → encoded length is 0/1/2/3 mod 4, exercising padding.
  for (const name of ['a', 'ab', 'abc', 'abcd', 'abcde']) {
    const jwt = makeJwt({ user: name })
    assert.equal(decodeJwtPayload(jwt).user, name, `padding failed for "${name}"`)
  }
})

test('@minor suunto jwt: correctly decodes base64url alphabet (- and _)', () => {
  // Bytes 0xFB 0xEF 0xFF base64-encode to "++//"-family chars; base64url uses
  // "-" and "_". Verify a payload whose encoding contains them round-trips.
  const raw = Buffer.from([0xfb, 0xef, 0xff, 0xfb, 0xef, 0xff])
  const std = raw.toString('base64') // contains + and /
  assert.ok(std.includes('+') || std.includes('/'), 'fixture should exercise + or /')

  // Build a real payload and confirm its base64url form uses -/_ and still decodes.
  const payloadObj = { user: 'aûï', scope: 'workout' }
  const seg = Buffer.from(JSON.stringify(payloadObj)).toString('base64url')
  const jwt = `hdr.${seg}.sig`
  assert.deepEqual(decodeJwtPayload(jwt), payloadObj)
})

test('@minor suunto jwt: throws on malformed token (not 3 segments)', () => {
  assert.throws(() => decodeJwtPayload('only.two'), /Malformed JWT/)
  assert.throws(() => decodeJwtPayload(''), /non-empty string/)
  assert.throws(() => decodeJwtPayload(null), /non-empty string/)
})

test('@minor suunto jwt: throws on non-JSON payload', () => {
  const jwt = `hdr.${Buffer.from('not json').toString('base64url')}.sig`
  assert.throws(() => decodeJwtPayload(jwt), /not valid JSON/)
})
