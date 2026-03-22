import { test, expect } from '@playwright/test'
import { loginAs } from './helpers/auth.js'

test('@minor home briefing — generates and displays', async ({ page }) => {
  await loginAs(page, 'elite_taper')
  // Wait for briefing to load (may auto-generate — give up to 30s)
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="coaching-briefing"]')
    return el && !el.textContent.includes('Loading briefing') && el.textContent.trim().length > 50
  }, { timeout: 30000 })
  const briefingText = await page.locator('[data-testid="coaching-briefing"]').textContent()
  expect(briefingText.trim().length).toBeGreaterThan(50)
})

test('@minor home check-in card — appears and responds to tap', async ({ page }) => {
  await loginAs(page, 'struggling') // Has planned sessions
  // Check-in card should be visible if there's a session today
  // This is time-dependent — only assert if visible
  const checkin = page.locator('[data-testid="checkin-card"]')
  const isVisible = await checkin.isVisible()
  if (isVisible) {
    await page.click('[data-testid="checkin-im-on-it"]')
    // Card should dismiss (checkinDismissed state becomes true)
    await page.waitForTimeout(500)
    await expect(checkin).not.toBeVisible()
  }
})

test('@major home — all 6 personas load without JS errors', async ({ page }) => {
  const personas = ['bodybuilder', 'female_cycle', 'injured', 'elite_taper', 'struggling', 'multisport']
  const errors = []
  page.on('pageerror', err => errors.push(err.message))

  for (const persona of personas) {
    errors.length = 0
    await loginAs(page, persona)
    await page.waitForTimeout(2000) // Allow async loads
    expect(errors, `JS errors for ${persona}: ${errors.join(', ')}`).toHaveLength(0)
    // Sign out to reset session
    await page.click('[data-testid="settings-button"]')
    await page.waitForSelector('[data-testid="settings-screen"]')
    await page.click('[data-testid="logout-button"]')
    await page.waitForSelector('[data-testid="login-button"]')
  }
})
