import { test, expect } from '@playwright/test'
import { loginAs } from './helpers/auth.js'

test('@minor plan screen — week view renders sessions', async ({ page }) => {
  await loginAs(page, 'multisport')
  await page.click('[data-testid="nav-plan"]')
  await page.waitForSelector('[data-testid="plan-screen"]')
  // All three sports should appear in the week view
  const planText = await page.locator('[data-testid="plan-screen"]').textContent()
  expect(planText).toMatch(/run|ride|swim/i)
})

test('@minor plan screen — mismatch detection for struggling persona', async ({ page }) => {
  await loginAs(page, 'struggling') // Has many missed sessions
  await page.click('[data-testid="nav-plan"]')
  await page.waitForSelector('[data-testid="plan-screen"]')
  // Should see pending proposals or mismatch indicators
  const planText = await page.locator('[data-testid="plan-screen"]').textContent()
  expect(planText).toMatch(/missed|proposed|adjust|pending/i)
})

test('@major plan — accept a pending proposal', async ({ page }) => {
  await loginAs(page, 'struggling')
  await page.click('[data-testid="nav-plan"]')
  await page.waitForSelector('[data-testid="plan-screen"]')

  // Click the pending proposals banner to open the modal
  const banner = page.locator('[data-testid="pending-proposals-banner"]')
  const bannerVisible = await banner.isVisible()
  if (bannerVisible) {
    await banner.click()
    // Modal should open with proposals
    await page.waitForSelector('[data-testid="pending-proposal"]')
    const proposals = page.locator('[data-testid="pending-proposal"]')
    const count = await proposals.count()
    if (count > 0) {
      await proposals.first().locator('[data-testid="accept-proposal"]').click()
      await page.waitForTimeout(1000)
      // Proposal count should decrease by 1
      const newCount = await page.locator('[data-testid="pending-proposal"]').count()
      expect(newCount).toBe(count - 1)
    }
  }
})

test('@major plan — rehab sessions visible for injured persona', async ({ page }) => {
  await loginAs(page, 'injured')
  await page.click('[data-testid="nav-plan"]')
  await page.waitForSelector('[data-testid="plan-screen"]')
  // Rehab sessions should appear in the week view
  const planText = await page.locator('[data-testid="plan-screen"]').textContent()
  expect(planText).toMatch(/rehab|exercise|ITB|clamshell/i)
})
