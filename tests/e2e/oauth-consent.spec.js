import { test, expect } from '@playwright/test'

// AC-156 — the OAuth consent page must never authorize "whatever session
// happens to be cached". With NO session it must render the LOGIN form (not a
// consent screen, not a crash). A fresh Playwright context has no Supabase
// session in localStorage, so this exercises the no-session path directly.
//
// Runs against a deployed target (PREVIEW_URL) — /oauth/authorize is a Vercel
// function, not a Vite route, so it 404s under the local :5173 dev server (same
// constraint as strava-webhook.spec.js). The session-present path (the "Signed
// in as <email>" line + account-switch control) needs a real validated Supabase
// session, which is heavy to mock and would fail getUser() anyway — it is
// covered by Richard's manual connector connect test instead, not over-built here.
test('@smoke oauth consent: no session renders the login form, not a consent screen', async ({ page }) => {
  await page.goto('/oauth/authorize?authorization_id=test')

  // Login form is shown
  await expect(page.getByRole('heading', { name: 'Sign in to authorize' })).toBeVisible()
  await expect(page.locator('#email')).toBeVisible()
  await expect(page.locator('#password')).toBeVisible()
  await expect(page.locator('#login')).toBeVisible()

  // NOT a consent screen (no Approve button without a validated session)
  await expect(page.locator('#approve')).toHaveCount(0)
})
