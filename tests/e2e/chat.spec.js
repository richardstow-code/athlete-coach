import { test, expect } from '@playwright/test'
import { loginAs } from './helpers/auth.js'

test('@minor chat — sends message and receives response', async ({ page }) => {
  await loginAs(page, 'elite_taper')
  await page.click('[data-testid="nav-chat"]')
  await page.waitForSelector('[data-testid="chat-screen"]')

  await page.fill('[data-testid="chat-input"]', 'How is my training looking this week?')
  await page.click('[data-testid="chat-send"]')

  // Response should appear within 15 seconds
  await page.waitForSelector('[data-testid="chat-response"]', { timeout: 15000 })
  const responseText = await page.locator('[data-testid="chat-response"]').last().textContent()
  expect(responseText.length).toBeGreaterThan(50)
})

test('@major chat — injured persona gets injury-aware response', async ({ page }) => {
  await loginAs(page, 'injured')
  await page.click('[data-testid="nav-chat"]')
  await page.waitForSelector('[data-testid="chat-screen"]')

  await page.fill('[data-testid="chat-input"]', 'Can I do a long run this weekend?')
  await page.click('[data-testid="chat-send"]')
  await page.waitForSelector('[data-testid="chat-response"]', { timeout: 15000 })

  const responseText = await page.locator('[data-testid="chat-response"]').last().textContent()
  // Should acknowledge the knee injury and advise caution
  expect(responseText).toMatch(/knee|injury|rehab|caution|careful|limit/i)
  // Should NOT prescribe a long run without caveats
  expect(responseText).not.toMatch(/go ahead|no problem|sure, do a long run/i)
})

test('@major chat — bodybuilder does not get running advice unprompted', async ({ page }) => {
  await loginAs(page, 'bodybuilder')
  await page.click('[data-testid="nav-chat"]')
  await page.waitForSelector('[data-testid="chat-screen"]')

  await page.fill('[data-testid="chat-input"]', 'What should I focus on this week?')
  await page.click('[data-testid="chat-send"]')
  await page.waitForSelector('[data-testid="chat-response"]', { timeout: 15000 })

  const responseText = await page.locator('[data-testid="chat-response"]').last().textContent()
  // Should mention strength/lifting not running
  expect(responseText).toMatch(/strength|lift|weight|muscle|compound/i)
})

test('@major chat — exchange is saved to coaching_memory', async ({ page }) => {
  await loginAs(page, 'multisport')
  await page.click('[data-testid="nav-chat"]')
  const uniqueMsg = `Test message ${Date.now()}`
  await page.fill('[data-testid="chat-input"]', uniqueMsg)
  await page.click('[data-testid="chat-send"]')
  await page.waitForSelector('[data-testid="chat-response"]', { timeout: 15000 })

  // Reload page
  await page.reload()
  await page.waitForSelector('[data-testid="chat-screen"]')

  // The message should still be in chat history
  const chatContent = await page.locator('[data-testid="chat-screen"]').textContent()
  expect(chatContent).toContain(uniqueMsg)
})
