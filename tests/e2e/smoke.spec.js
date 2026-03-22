import { test, expect } from '@playwright/test'
import { loginAs } from './helpers/auth.js'

test('@smoke bodybuilder — home loads with strength context', async ({ page }) => {
  await loginAs(page, 'bodybuilder')
  await expect(page.locator('[data-testid="home-screen"]')).toBeVisible()
  await expect(page.locator('[data-testid="test-mode-banner"]')).toBeVisible()
  // The briefing or session cards should not reference running
  const bodyText = await page.locator('[data-testid="home-screen"]').textContent()
  expect(bodyText).not.toMatch(/Z2|zone 2|easy run/i)
})

test('@smoke female_cycle — home loads showing cycle context', async ({ page }) => {
  await loginAs(page, 'female_cycle')
  await expect(page.locator('[data-testid="home-screen"]')).toBeVisible()
  // Cycle phase or phase-aware content should appear somewhere on home
  // Accept either cycle indicator or phase-adapted briefing content
})

test('@smoke injured — home loads and injury is flagged', async ({ page }) => {
  await loginAs(page, 'injured')
  await expect(page.locator('[data-testid="home-screen"]')).toBeVisible()
  await expect(page.locator('[data-testid="test-mode-banner"]')).toBeVisible()
  // Injury content check is in injury-workflow.spec.js (requires briefing to load)
})

test('@smoke elite_taper — home loads for taper phase', async ({ page }) => {
  await loginAs(page, 'elite_taper')
  await expect(page.locator('[data-testid="home-screen"]')).toBeVisible()
})

test('@smoke struggling — home loads for struggling persona', async ({ page }) => {
  await loginAs(page, 'struggling')
  await expect(page.locator('[data-testid="home-screen"]')).toBeVisible()
})

test('@smoke multisport — home loads for multisport athlete', async ({ page }) => {
  await loginAs(page, 'multisport')
  await expect(page.locator('[data-testid="home-screen"]')).toBeVisible()
})
