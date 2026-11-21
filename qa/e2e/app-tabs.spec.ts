import { test, expect, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const GATE = process.env.QA_GATE ?? 'M1'
const SHOTS = join(__dirname, '..', '..', 'docs', 'qa', 'shots', GATE)
mkdirSync(SHOTS, { recursive: true })

const TABS = ['home', 'room', 'dataset', 'habit', 'gestures', 'live', 'record', 'lock'] as const
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
] as const

// Text that must never reach a judge.
const PLACEHOLDER = /\bTODO\b|lorem ipsum|undefined|NaN|\[object Object\]|Next \(#\d+\)/i

interface Noise { console: string[]; pageErrors: string[]; failed: string[] }

function watch(page: Page): Noise {
  const n: Noise = { console: [], pageErrors: [], failed: [] }
  page.on('console', (m) => { if (m.type() === 'error') n.console.push(m.text()) })
  page.on('pageerror', (e) => n.pageErrors.push(String(e)))
  page.on('requestfailed', (r) => n.failed.push(`${r.method()} ${r.url()} ${r.failure()?.errorText}`))
  page.on('response', (r) => { if (r.status() >= 400) n.failed.push(`${r.status()} ${r.url()}`) })
  return n
}

for (const vp of VIEWPORTS) {
  for (const tab of TABS) {
    test(`${tab} @ ${vp.name}: loads clean, no overflow, no placeholder text`, async ({ page }) => {
      const noise = watch(page)
      await page.setViewportSize({ width: vp.width, height: vp.height })
      await page.goto(`/#${tab}`)
      await page.waitForLoadState('networkidle')
      await page.screenshot({ path: join(SHOTS, `${tab}-${vp.name}.png`), fullPage: true })

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      const body = await page.locator('body').innerText()

      expect.soft(noise.pageErrors, 'uncaught page errors').toEqual([])
      expect.soft(noise.console, 'console errors').toEqual([])
      expect.soft(noise.failed, 'failed requests').toEqual([])
      expect.soft(overflow, 'horizontal overflow px').toBeLessThanOrEqual(0)
      expect.soft(body.match(PLACEHOLDER)?.[0] ?? null, 'placeholder text on screen').toBeNull()
    })
  }
}

test('hash router rejects prototype keys (#constructor must land on a real page)', async ({ page }) => {
  await page.goto('/#constructor')
  await page.waitForLoadState('networkidle')
  const bold = await page.locator('nav button').evaluateAll((bs) => bs.filter((b) => getComputedStyle(b).fontWeight === '800' || getComputedStyle(b).fontWeight === 'bold').length)
  expect(bold, 'exactly one nav tab highlighted').toBe(1)
})

test('hash change in an open tab switches page (blocked.html link back to /#lock)', async ({ page }) => {
  await page.goto('/#room')
  await page.waitForLoadState('networkidle')
  await page.evaluate(() => { location.hash = 'lock' })
  // Lock page shows its extension controls; an unchanged Room page would not.
  await expect(page.getByRole('button', { name: /unlock/i }).first()).toBeVisible({ timeout: 3000 })
})

test('lock page without an extension id shows a friendly message, not a crash', async ({ page }) => {
  const noise = watch(page)
  await page.goto('/#lock')
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: /^lock$/i }).first().click()
  await page.waitForTimeout(500)
  const body = await page.locator('body').innerText()
  expect(noise.pageErrors).toEqual([])
  expect(body).not.toMatch(/ReferenceError/)
})

test('lock page implements the secret rhythm (demo step 2), not just extension buttons', async ({ page }) => {
  await page.goto('/#lock')
  await page.waitForLoadState('networkidle')
  const body = (await page.locator('body').innerText()).toLowerCase()
  // Demo needs a real control to set the secret sequence (issue #12). A sentence that merely
  // mentions "secret rhythm" (the "Next (#12)" placeholder) must not count.
  expect(body, 'placeholder copy must be gone').not.toMatch(/next \(#\d+\)/)
  await expect(page.getByRole('button', { name: /set (the )?(secret|password|sequence)|record (the )?(secret|sequence)/i }).first()).toBeVisible({ timeout: 2000 })
})

test('lock: an existing password cannot be replaced without knowing it (kid bypass)', async ({ page }) => {
  // A parent already set a password; a child now sits at the open Echo tab with the mic allowed.
  await page.addInitScript(() => localStorage.setItem('echo.lock.password', JSON.stringify(['PUSH', 'PULL', 'WAVE', 'OPEN_CLOSE'])))
  await page.goto('/#lock')
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: /start sonar/i }).first().click()
  await page.waitForTimeout(4500) // calibrate(3000)
  const change = page.getByRole('button', { name: /change password|set password/i })
  await page.screenshot({ path: join(SHOTS, 'lock-change-password.png'), fullPage: true })
  const reachable = (await change.count()) > 0 && (await change.first().isEnabled())
  expect(reachable, 'Change password must require the current password (or be hidden while locked)').toBe(false)
})

test('dataset: switching tabs mid-take must not wedge the next take', async ({ page }) => {
  await page.goto('/#dataset')
  await page.waitForLoadState('networkidle')
  await page.getByPlaceholder('e.g. EJ2007').fill('qa-bot')
  await page.getByPlaceholder('e.g. MacBook Air M2').fill('qa-laptop')
  await page.getByRole('button', { name: /start sonar and calibrate/i }).click()
  await expect(page.getByText(/tone health/i).first()).toBeVisible({ timeout: 15000 })
  await page.getByRole('button', { name: /record this take/i }).click()
  await expect(page.getByText(/take your hands away/i)).toBeVisible()
  // Impatient user hops to another tab during the 2 s grace period, then comes back.
  await page.getByRole('button', { name: /^Room test$/ }).click()
  await page.waitForTimeout(2500)
  await page.getByRole('button', { name: /^Dataset recording$/ }).click()
  // Back on a fresh Dataset page: restart sonar if the page forgot, then try the take again.
  const startAgain = page.getByRole('button', { name: /start sonar and calibrate/i })
  if (await startAgain.isVisible()) { await startAgain.click(); await page.waitForTimeout(3500) }
  const rec = page.getByRole('button', { name: /record this take/i })
  await expect(rec).toBeEnabled({ timeout: 8000 })
  await rec.click()
  await page.waitForTimeout(3500)
  await page.screenshot({ path: join(SHOTS, 'dataset-after-tab-switch.png'), fullPage: true })
  // Either the take is running (countdown) or a visible error with the controls still usable. Never a dead page.
  const controlsBack = await page.getByRole('button', { name: /record this take/i }).isVisible()
  const takeRunning = await page.getByText(/hands off|take your hands away|GO:/i).isVisible()
  expect(controlsBack || takeRunning, 'page is not stuck with controls hidden and no countdown moving').toBe(true)
  const stuck = await page.getByText(/take your hands away… 1/i).isVisible()
  expect(stuck, 'stuck on the "hands away" box after an error').toBe(false)
})

test('double-click on primary buttons does not throw', async ({ page }) => {
  for (const tab of TABS) {
    const noise = watch(page)
    await page.goto(`/#${tab}`)
    await page.waitForLoadState('networkidle')
    const buttons = page.locator('div > button').filter({ hasNotText: /^(Room test|Dataset recording|Habit recording|Gesture test|Live test|Pilot record|Lock)/ })
    const count = await buttons.count()
    for (let i = 0; i < Math.min(count, 6); i++) {
      const b = buttons.nth(i)
      if (await b.isVisible() && await b.isEnabled()) await b.dblclick({ timeout: 2000 }).catch(() => undefined)
    }
    await page.waitForTimeout(300)
    expect.soft(noise.pageErrors, `${tab}: page errors after double-click`).toEqual([])
  }
})

test('room test: start sonar with a (fake) mic completes without page errors', async ({ page }) => {
  const noise = watch(page)
  await page.goto('/#room')
  await page.waitForLoadState('networkidle')
  // Room test is a stepped flow: an intro step ("Done, next") comes before "Start sonar".
  const intro = page.getByRole('button', { name: /done, next/i })
  if (await intro.isVisible()) await intro.click()
  const start = page.getByRole('button', { name: /start sonar/i })
  await expect(start).toBeVisible()
  await start.click()
  await page.waitForTimeout(2500)
  await page.screenshot({ path: join(SHOTS, 'room-started-desktop.png'), fullPage: true })
  expect(noise.pageErrors, 'page errors after start').toEqual([])
  const body = await page.locator('body').innerText()
  expect(body).not.toMatch(/Microphone unavailable/)
})
