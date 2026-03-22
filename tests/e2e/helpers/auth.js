export async function loginAs(page, persona) {
  const credentials = {
    bodybuilder:  { email: 'bodybuilder@test.athletecoach.app',  password: 'TestPass123!' },
    female_cycle: { email: 'femalecycle@test.athletecoach.app',  password: 'TestPass123!' },
    injured:      { email: 'injured@test.athletecoach.app',      password: 'TestPass123!' },
    elite_taper:  { email: 'elitetaper@test.athletecoach.app',   password: 'TestPass123!' },
    struggling:   { email: 'struggling@test.athletecoach.app',   password: 'TestPass123!' },
    multisport:   { email: 'multisport@test.athletecoach.app',   password: 'TestPass123!' },
  }
  const { email, password } = credentials[persona]
  await page.goto('/')
  await page.fill('[data-testid="email-input"]', email)
  await page.fill('[data-testid="password-input"]', password)
  await page.click('[data-testid="login-button"]')
  await page.waitForURL('/')
  await page.waitForSelector('[data-testid="home-screen"]', { timeout: 10000 })
}
