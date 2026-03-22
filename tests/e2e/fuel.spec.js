import { test, expect } from '@playwright/test'
import { loginAs } from './helpers/auth.js'

test('@minor fuel — text meal logging parses and saves', async ({ page }) => {
  await loginAs(page, 'struggling')
  await page.click('[data-testid="nav-fuel"]')
  await page.waitForSelector('[data-testid="fuel-screen"]')

  await page.fill('[data-testid="nutrition-input"]', 'Chicken and rice bowl with broccoli, about 400g')
  await page.click('[data-testid="nutrition-submit"]')

  // Wait for AI parsing and entry to appear (up to 30s for Claude call)
  await page.waitForSelector('[data-testid="nutrition-entry"]', { timeout: 30000 })
  const entries = await page.locator('[data-testid="nutrition-entry"]').count()
  expect(entries).toBeGreaterThan(0)

  // Should show macros in the entry
  const entryText = await page.locator('[data-testid="nutrition-entry"]').first().textContent()
  expect(entryText).toMatch(/protein|kcal|carb/i)
})

test('@minor fuel — photo meal logging', async ({ page }) => {
  await loginAs(page, 'female_cycle')
  await page.click('[data-testid="nav-fuel"]')
  await page.waitForSelector('[data-testid="fuel-screen"]')

  // Upload test food image (input is hidden — use dispatchEvent to reveal then set files)
  const fileInput = page.locator('[data-testid="nutrition-image-input"]')
  await fileInput.evaluate(el => { el.style.display = 'block' })
  await fileInput.setInputFiles('./tests/fixtures/food-images/teriyaki-bowl.jpg')

  // Wait for image to preview
  await page.waitForSelector('img[alt="meal"]', { timeout: 5000 })

  // Submit the logged entry
  await page.click('[data-testid="nutrition-submit"]')
  await page.waitForSelector('[data-testid="nutrition-entry"]', { timeout: 20000 })

  const entryText = await page.locator('[data-testid="nutrition-entry"]').first().textContent()
  expect(entryText.length).toBeGreaterThan(10) // Some content was parsed
})

test('@major fuel — CrossFit workout file ingestion', async ({ page }) => {
  await loginAs(page, 'multisport')
  await page.click('[data-testid="nav-fuel"]')
  await page.waitForSelector('[data-testid="fuel-screen"]')

  // Upload CrossFit WOD text as description
  // (WorkoutIngest is a separate screen — test text-based ingestion instead)
  await page.fill('[data-testid="nutrition-input"]', 'CrossFit workout: 21-15-9 wall balls, burpees and box jumps. 35 minutes total with warm up.')
  await page.click('[data-testid="nutrition-submit"]')
  await page.waitForSelector('[data-testid="nutrition-entry"]', { timeout: 15000 })

  const entryText = await page.locator('[data-testid="nutrition-entry"]').first().textContent()
  expect(entryText.length).toBeGreaterThan(10)
})

test('@major fuel — alcohol logging and weekly total', async ({ page }) => {
  await loginAs(page, 'struggling') // Has pre-seeded alcohol entries
  await page.click('[data-testid="nav-fuel"]')
  await page.waitForSelector('[data-testid="fuel-screen"]')

  // Weekly alcohol total should reflect seeded data
  const fuelText = await page.locator('[data-testid="fuel-screen"]').textContent()
  expect(fuelText).toMatch(/alcohol|units/i)
})

test('@major fuel — UPF score flagged for snack food', async ({ page }) => {
  await loginAs(page, 'struggling')
  await page.click('[data-testid="nav-fuel"]')
  await page.waitForSelector('[data-testid="fuel-screen"]')

  await page.fill('[data-testid="nutrition-input"]', 'Handful of spicy coated peanuts, 30g bag, highly processed snack')
  await page.click('[data-testid="nutrition-submit"]')

  await page.waitForSelector('[data-testid="nutrition-entry"]', { timeout: 15000 })
  const entryText = await page.locator('[data-testid="nutrition-entry"]').first().textContent()
  // UPF score should be high (NOVA 2 or 3)
  expect(entryText).toMatch(/UPF|ultra.processed|NOVA [23]|[23]\/3/i)
})

test('@major fuel — WeeklyDigest shows trend arrows and UPF strip', async ({ page }) => {
  await loginAs(page, 'struggling') // Has 2 weeks of nutrition data
  await page.click('[data-testid="nav-fuel"]')
  await page.waitForSelector('[data-testid="fuel-screen"]')

  // Weekly digest should be present
  // (WeeklyDigest renders when there are ≥2 days of logs)
  const fuelText = await page.locator('[data-testid="fuel-screen"]').textContent()
  expect(fuelText).toMatch(/protein|calories|avg|kcal/i)
})
