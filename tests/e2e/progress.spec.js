import { test, expect } from '@playwright/test'
import { loginAs } from './helpers/auth.js'

test('@minor progress — macro view renders for runner', async ({ page }) => {
  await loginAs(page, 'elite_taper')
  await page.click('[data-testid="nav-progress"]')
  await page.waitForSelector('[data-testid="progress-screen"]')

  const progressText = await page.locator('[data-testid="progress-screen"]').textContent()
  // Should show training load / fitness metrics for a runner
  expect(progressText).toMatch(/load|fitness|fatigue|TSS|HR|pace|km/i)
})

test('@minor progress — micro view renders health markers', async ({ page }) => {
  await loginAs(page, 'struggling')
  await page.click('[data-testid="nav-progress"]')
  await page.waitForSelector('[data-testid="progress-screen"]')

  // Switch to micro view
  await page.click('[data-testid="progress-micro-toggle"]')
  await page.waitForTimeout(500)

  const progressText = await page.locator('[data-testid="progress-screen"]').textContent()
  // Micro view should show HRV / sleep / recovery data
  expect(progressText).toMatch(/HRV|sleep|recovery|readiness|resting/i)
})

test('@minor progress — bodybuilder sees strength metrics not run pace', async ({ page }) => {
  await loginAs(page, 'bodybuilder')
  await page.click('[data-testid="nav-progress"]')
  await page.waitForSelector('[data-testid="progress-screen"]')

  const progressText = await page.locator('[data-testid="progress-screen"]').textContent()
  // Should not show running pace for a non-runner
  expect(progressText).not.toMatch(/pace|min\/km|min\/mi/i)
})
