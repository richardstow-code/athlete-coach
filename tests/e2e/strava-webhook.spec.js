import { test, expect } from '@playwright/test'

// These tests hit the Vercel serverless function directly.
// They require PREVIEW_URL to be set in the environment.
// They are tagged @major and run only in CI against a Preview deployment.

const WEBHOOK_URL = `${process.env.PREVIEW_URL || 'http://localhost:5173'}/api/strava-webhook`

// Strava webhook verification handshake
test('@major strava-webhook — GET handshake responds with hub.challenge', async ({ request }) => {
  const challenge = 'test_challenge_12345'
  const response = await request.get(WEBHOOK_URL, {
    params: {
      'hub.mode': 'subscribe',
      'hub.challenge': challenge,
      'hub.verify_token': process.env.STRAVA_VERIFY_TOKEN || 'athletecoach_webhook_secret',
    },
  })
  expect(response.status()).toBe(200)
  const body = await response.json()
  expect(body['hub.challenge']).toBe(challenge)
})

// Activity created event triggers plan update
test('@major strava-webhook — POST activity.create returns 200', async ({ request }) => {
  const payload = {
    aspect_type: 'create',
    event_time: Math.floor(Date.now() / 1000),
    object_id: 999999999,
    object_type: 'activity',
    owner_id: 12345678,
    subscription_id: 1,
    updates: {},
  }
  const response = await request.post(WEBHOOK_URL, {
    data: payload,
    headers: { 'Content-Type': 'application/json' },
  })
  // Should acknowledge the webhook immediately
  expect(response.status()).toBe(200)
})

// Activity update event
test('@major strava-webhook — POST activity.update returns 200', async ({ request }) => {
  const payload = {
    aspect_type: 'update',
    event_time: Math.floor(Date.now() / 1000),
    object_id: 999999999,
    object_type: 'activity',
    owner_id: 12345678,
    subscription_id: 1,
    updates: { title: 'Updated run title' },
  }
  const response = await request.post(WEBHOOK_URL, {
    data: payload,
    headers: { 'Content-Type': 'application/json' },
  })
  expect(response.status()).toBe(200)
})

// Invalid verify token should be rejected
test('@major strava-webhook — GET with wrong verify token returns 403', async ({ request }) => {
  const response = await request.get(WEBHOOK_URL, {
    params: {
      'hub.mode': 'subscribe',
      'hub.challenge': 'test_challenge',
      'hub.verify_token': 'wrong_token',
    },
  })
  expect(response.status()).toBe(403)
})
