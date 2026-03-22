import { test, expect } from '@playwright/test'

test('@minor new user sees onboarding flow', async ({ page }) => {
  // Login as new user
  await page.goto('/')
  await page.fill('[data-testid="email-input"]', 'newuser@test.athletecoach.app')
  await page.fill('[data-testid="password-input"]', 'TestPass123!')
  await page.click('[data-testid="login-button"]')

  // Should redirect to onboarding, not home
  await page.waitForSelector('[data-testid="onboarding-screen"]')

  // Step 1: Basic info / goal type
  await expect(page.locator('text=What\'s your main goal?')).toBeVisible()
  // Select first goal type tile
  await page.locator('[data-testid^="goal-tile-"]').first().click()
  await page.click('[data-testid="onboarding-next"]')

  // Step 2: Strava connect — skip in test mode
  await page.waitForSelector('[data-testid="onboarding-step-2"]')
  await page.click('[data-testid="onboarding-skip-strava"]')

  // Step 3: Sport chips
  await page.waitForSelector('[data-testid="sport-chips"]')
  await page.click('[data-testid="sport-chip-running"]')
  await expect(page.locator('[data-testid="sport-chip-running"]')).toHaveCSS('color', /232|233|e8ff47/)
  // Toggle off and back on
  await page.click('[data-testid="sport-chip-running"]')
  await page.click('[data-testid="sport-chip-running"]')
  await page.click('[data-testid="onboarding-next"]')

  // Step 4: Race/target setup
  await page.waitForSelector('[data-testid="onboarding-race-setup"]')
  await page.click('[data-testid="onboarding-next"]') // Skip — textarea may be empty

  // Step 5: Profile complete — level slider visible
  await page.waitForSelector('[data-testid="onboarding-complete"]')
  await page.click('[data-testid="onboarding-finish"]')

  // Should land on home screen
  await page.waitForSelector('[data-testid="home-screen"]')
})
