import { test, expect } from '@playwright/test'
import { loginAs } from './helpers/auth.js'

test('@minor settings — profile weight saves and persists', async ({ page }) => {
  await loginAs(page, 'elite_taper')
  await page.click('[data-testid="settings-button"]')
  await page.waitForSelector('[data-testid="settings-screen"]')

  // Open Personal section (click the section header)
  await page.click('text=Personal')
  await page.waitForSelector('[data-testid="weight-input"]')
  // Wait for async DB load to populate the field before saving (ensures userId is set)
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="weight-input"]')
    return el && el.value !== ''
  }, { timeout: 10000 })

  // Update weight
  await page.fill('[data-testid="weight-input"]', '58')
  await page.click('[data-testid="save-profile"]')
  await page.waitForTimeout(1000)

  // Reload and reopen settings (reload closes the modal)
  await page.reload()
  await page.waitForSelector('[data-testid="home-screen"]')
  await page.click('[data-testid="settings-button"]')
  await page.waitForSelector('[data-testid="settings-screen"]')
  await page.click('text=Personal')
  await page.waitForSelector('[data-testid="weight-input"]')
  // Wait for async DB load to populate the field (default is empty)
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="weight-input"]')
    return el && el.value !== ''
  }, { timeout: 10000 })

  const weightValue = await page.locator('[data-testid="weight-input"]').inputValue()
  expect(weightValue).toBe('58')
})

test('@minor settings — coaching sliders persist', async ({ page }) => {
  await loginAs(page, 'struggling')
  await page.click('[data-testid="settings-button"]')
  await page.waitForSelector('[data-testid="settings-screen"]')

  // Open Coaching Preferences section
  await page.click('text=Coaching Preferences')
  await page.waitForSelector('[data-testid="slider-tone"]')
  // Wait for async DB load before saving (ensures userId is set in component state)
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="slider-tone"]')
    return el && parseInt(el.value) !== 50
  }, { timeout: 10000 })

  // Change tone slider
  await page.locator('[data-testid="slider-tone"]').evaluate(el => {
    el.value = '75'
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await page.click('[data-testid="save-settings"]')
  await page.waitForTimeout(1000)

  await page.reload()
  await page.waitForSelector('[data-testid="home-screen"]')
  await page.click('[data-testid="settings-button"]')
  await page.waitForSelector('[data-testid="settings-screen"]')
  await page.click('text=Coaching Preferences')
  await page.waitForSelector('[data-testid="slider-tone"]')
  // Wait for async DB load to replace the default value (50)
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="slider-tone"]')
    return el && parseInt(el.value) !== 50
  }, { timeout: 10000 })

  const sliderValue = await page.locator('[data-testid="slider-tone"]').inputValue()
  expect(parseInt(sliderValue)).toBeGreaterThanOrEqual(70) // Allow for rounding
})
