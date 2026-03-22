import { test, expect } from '@playwright/test'
import { loginAs } from './helpers/auth.js'

test('@major injury — post-run injury report flow', async ({ page }) => {
  await loginAs(page, 'elite_taper')
  await page.waitForSelector('[data-testid="home-screen"]')

  // Check-in card should be visible if there's a session today
  const checkin = page.locator('[data-testid="checkin-card"]')
  const isVisible = await checkin.isVisible()
  if (!isVisible) {
    // No session today — skip the rest of this test
    test.skip()
    return
  }

  // Click "I did it" to start check-in flow
  await page.click('[data-testid="checkin-im-on-it"]')
  await page.waitForTimeout(500)

  // If a pain/discomfort question appears, report knee pain
  const painPrompt = page.locator('[data-testid="pain-prompt"]')
  const painVisible = await painPrompt.isVisible()
  if (painVisible) {
    await page.click('[data-testid="pain-yes"]')
    await page.waitForSelector('[data-testid="pain-location-input"]')
    await page.fill('[data-testid="pain-location-input"]', 'knee')
    await page.click('[data-testid="pain-submit"]')
    await page.waitForTimeout(1000)

    // Home should now reflect injury awareness
    const homeText = await page.locator('[data-testid="home-screen"]').textContent()
    expect(homeText).toMatch(/knee|injury|caution|rehab/i)
  }
})

test('@major injury — injured persona rehab session detail', async ({ page }) => {
  await loginAs(page, 'injured')
  await page.click('[data-testid="nav-plan"]')
  await page.waitForSelector('[data-testid="plan-screen"]')

  // Rehab sessions should appear in the plan
  const planText = await page.locator('[data-testid="plan-screen"]').textContent()
  expect(planText).toMatch(/rehab|exercise|ITB|clamshell/i)

  // Click into a rehab session if one is visible
  const rehabSession = page.locator('[data-testid="session-row"]').filter({ hasText: /rehab|clamshell|ITB/i }).first()
  const rehabVisible = await rehabSession.isVisible()
  if (rehabVisible) {
    await rehabSession.click()
    await page.waitForTimeout(500)

    // Detail or expanded view should show exercise instructions
    const sessionDetail = page.locator('[data-testid="session-detail"], [data-testid="plan-screen"]')
    const detailText = await sessionDetail.textContent()
    expect(detailText).toMatch(/sets|reps|exercise|minute|hold/i)
  }
})

test('@major injury — chat refuses long run for injured persona', async ({ page }) => {
  await loginAs(page, 'injured')
  await page.click('[data-testid="nav-chat"]')
  await page.waitForSelector('[data-testid="chat-screen"]')

  await page.fill('[data-testid="chat-input"]', 'I want to do a 20km long run this weekend, is that ok?')
  await page.click('[data-testid="chat-send"]')
  await page.waitForSelector('[data-testid="chat-response"]', { timeout: 15000 })

  const responseText = await page.locator('[data-testid="chat-response"]').last().textContent()
  // Should advise against it given the knee injury
  expect(responseText).toMatch(/knee|injury|caution|careful|recommend|instead|rehab/i)
  expect(responseText).not.toMatch(/go for it|sounds great|absolutely|20km is fine/i)
})
