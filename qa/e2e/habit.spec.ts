import { test, expect, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

// Habit mode (EJ's lane), queue item 2 of the lead's QA queue (comment 7066454821).
// Page logic is driven through the real UI. Gestures cannot come from a fake mic, so the test serves app/src/engine.ts
// with a tiny wrapper that remembers every onGesture callback; window.__emit(g) then plays a gesture into the app
// exactly as the engine would. What this proves: the HabitWatch rules. What it cannot prove: that the real sonar
// produces REPETITIVE / UNDO / PUSH at the right moments (needs a human).
const GATE = process.env.QA_GATE ?? 'HABIT'
const SHOTS = join(__dirname, '..', '..', 'docs', 'qa', 'shots', GATE)
mkdirSync(SHOTS, { recursive: true })

const HOOK = `
;(() => {
  const cbs = []; const orig = engine.onGesture.bind(engine)
  engine.onGesture = (cb) => { cbs.push(cb); const off = orig(cb); return () => { const i = cbs.indexOf(cb); if (i >= 0) cbs.splice(i, 1); off() } }
  window.__emit = (g) => { for (const cb of [...cbs]) cb({ confidence: 0.9, ...g }) }
  window.__cbCount = () => cbs.length
})()
`

interface Noise { console: string[]; pageErrors: string[] }
function watch(page: Page): Noise {
  const n: Noise = { console: [], pageErrors: [] }
  page.on('console', (m) => { if (m.type() === 'error') n.console.push(m.text()) })
  page.on('pageerror', (e) => n.pageErrors.push(String(e)))
  return n
}

async function open(page: Page, init: Record<string, string> = {}) {
  await page.route('**/src/engine.ts*', async (route) => {
    const res = await route.fetch()
    await route.fulfill({ response: res, body: (await res.text()) + HOOK })
  })
  await page.addInitScript((kv) => { for (const [k, v] of Object.entries(kv)) if (localStorage.getItem(k) === null) localStorage.setItem(k, v) }, init)
  await page.goto('/#habit-app')
  await page.waitForLoadState('networkidle')
  await expect.poll(() => page.evaluate(() => (window as unknown as { __cbCount?: () => number }).__cbCount?.() ?? 0)).toBeGreaterThan(0)
}
const emit = (page: Page, g: { type: string; confidence?: number }) => page.evaluate((x) => (window as unknown as { __emit: (g: unknown) => void }).__emit(x), g)
const ls = (page: Page, k: string) => page.evaluate((key) => localStorage.getItem(key), k)
const nudges = async (page: Page) => Number((await page.locator('.hb-big').first().innerText()).trim())
/** Habit ignores REPETITIVE for 2.5 s after any key or pointer input on the page. */
const quiet = (page: Page) => page.waitForTimeout(2700)

test('habit page: loads clean on desktop and mobile, no placeholder, no overflow at 1440 and 390', async ({ page }) => {
  const noise = watch(page)
  for (const [w, h] of [[1440, 900], [390, 844]] as const) {
    await page.setViewportSize({ width: w, height: h })
    await open(page)
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect.soft(over, `horizontal overflow at ${w}`).toBeLessThanOrEqual(0)
    await page.screenshot({ path: join(SHOTS, `habit-off-${w}.png`), fullPage: true })
  }
  expect(await page.locator('body').innerText()).not.toMatch(/undefined|NaN|\[object|TODO/)
  expect(noise.pageErrors).toEqual([])
  expect(noise.console).toEqual([])
})

test('demo toggle: seeds a believable week, real data is untouched and comes back', async ({ page }) => {
  const real = [Date.now() - 3600e3, Date.now() - 1800e3]
  await open(page, { 'echo.habit.log': JSON.stringify(real) })
  expect(await nudges(page)).toBe(2)
  await page.getByRole('button', { name: /demo: off/i }).click()
  await expect(page.getByText('demo data')).toBeVisible()
  await expect(page.getByRole('button', { name: /demo: on/i })).toHaveAttribute('aria-pressed', 'true')
  const days = await page.locator('.hb-day__n').allInnerTexts()
  expect(days, '7 days shown').toHaveLength(7)
  expect(days.slice(0, 6).filter((d) => Number(d) > 0).length, 'demo past days are not empty').toBeGreaterThanOrEqual(5)
  expect(await page.locator('body').innerText()).not.toMatch(/undefined|NaN/)
  await page.screenshot({ path: join(SHOTS, 'habit-demo-1440.png'), fullPage: true })
  await page.getByRole('button', { name: /demo: on/i }).click()
  await expect(page.getByText('demo data')).toHaveCount(0)
  expect(JSON.parse((await ls(page, 'echo.habit.log')) ?? '[]'), 'real log unchanged').toEqual(real)
  expect(await nudges(page)).toBe(2)
})

test('demo toggle: turning it off and on again must not wipe nudges made during the demo', async ({ page }) => {
  test.fail(true, 'P2: setHabitDemo(true) re-seeds and overwrites echo.habit.demoLog; remove this line once fixed')
  await open(page, { 'echo.habit.on': '1' })
  await page.getByRole('button', { name: /demo: off/i }).click()
  const before = await nudges(page)
  await quiet(page)
  await emit(page, { type: 'REPETITIVE' })
  await expect.poll(() => nudges(page)).toBe(before + 1)
  await page.getByRole('button', { name: /demo: on/i }).click() // off
  await page.getByRole('button', { name: /demo: off/i }).click() // on again: re-seeds
  expect(await nudges(page), 'live demo nudge survives a toggle').toBe(before + 1)
})

test('turn on: 10 s calibration screen counts down, then Watching; Turn off stops it', async ({ page }) => {
  const noise = watch(page)
  await open(page)
  await page.getByRole('button', { name: /^turn on$/i }).click()
  await expect(page.getByText(/ECHØ HABIT · CALIBRATING/)).toBeVisible()
  await page.screenshot({ path: join(SHOTS, 'habit-calibrating.png') })
  await expect(page.getByText('Watching.')).toBeVisible({ timeout: 30000 })
  expect(await ls(page, 'echo.habit.on')).toBe('1')
  await page.getByRole('button', { name: /^turn off$/i }).click()
  await expect(page.getByText('Habit mode off')).toBeVisible()
  expect(await ls(page, 'echo.habit.on')).toBe('0')
  expect(noise.pageErrors).toEqual([])
})

test('calibration: Cancel returns to off and never turns Habit on afterwards', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: /^turn on$/i }).click()
  await expect(page.getByText(/CALIBRATING/)).toBeVisible()
  await page.waitForTimeout(1500)
  await page.getByRole('button', { name: /^cancel$/i }).click()
  await expect(page.getByText('Habit mode off')).toBeVisible()
  await page.waitForTimeout(16000) // longer than the whole calibration
  await expect(page.getByText('Habit mode off')).toBeVisible()
  expect(await ls(page, 'echo.habit.on'), 'a cancelled calibration must not switch Habit on').not.toBe('1')
})

test('calibration: Cancel then Turn on again is not finished early by the cancelled run (EJ fix, per-run token)', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: /^turn on$/i }).click()
  await expect(page.getByText(/CALIBRATING/)).toBeVisible()
  await page.waitForTimeout(8000) // sonar warm, first run deep in its 10 s calibration
  await page.getByRole('button', { name: /^cancel$/i }).click()
  await page.getByRole('button', { name: /^turn on$/i }).click()
  await expect(page.getByText(/CALIBRATING/)).toBeVisible()
  const t0 = Date.now()
  // The cancelled run would have ended about 5 s from here. The new run needs a full 10 s.
  await page.waitForTimeout(6500)
  expect(await ls(page, 'echo.habit.on'), 'stale run must not switch Habit on while the new calibration is still counting').not.toBe('1')
  await expect(page.getByText('Watching.')).toBeVisible({ timeout: 30000 })
  expect(Date.now() - t0, 'second calibration took its full time').toBeGreaterThan(8000)
})

test('snooze: button snoozes, chip + Resume now show, Resume now ends it, survives a reload', async ({ page }) => {
  await open(page, { 'echo.habit.on': '1' })
  await page.getByRole('button', { name: /snooze 10 min/i }).click()
  await expect(page.getByText(/snoozed (9|10) min/)).toBeVisible()
  await page.reload(); await page.waitForLoadState('networkidle')
  await expect(page.getByText(/snoozed (9|10) min/)).toBeVisible()
  await page.screenshot({ path: join(SHOTS, 'habit-snoozed.png'), fullPage: true })
  await page.getByRole('button', { name: /resume now/i }).click()
  await expect(page.getByText(/snoozed/)).toHaveCount(0)
  expect(await ls(page, 'echo.habit.snoozeUntil')).toBe('0')
})

test('HabitWatch rules: one REPETITIVE = one nudge with toast and a log entry; the cooldown folds repeats', async ({ page }) => {
  const noise = watch(page)
  await open(page, { 'echo.habit.on': '1' })
  await quiet(page)
  const base = await nudges(page)
  await emit(page, { type: 'REPETITIVE' })
  await expect(page.getByText(/hands · \d+ today/)).toBeVisible()
  await emit(page, { type: 'REPETITIVE' }) // inside the 8 s cooldown
  await emit(page, { type: 'REPETITIVE' })
  await expect.poll(() => nudges(page)).toBe(base + 1)
  expect(noise.pageErrors).toEqual([])
  expect(noise.console.filter((c) => !/AudioContext/i.test(c)), 'console errors (AudioContext aside)').toEqual([])
})

test('HabitWatch rules: REPETITIVE is ignored while typing or moving the pointer', async ({ page }) => {
  await open(page, { 'echo.habit.on': '1' })
  await quiet(page)
  const base = await nudges(page)
  await page.mouse.move(200, 200); await page.mouse.move(260, 240)
  await emit(page, { type: 'REPETITIVE' })
  await page.waitForTimeout(400)
  expect(await nudges(page), 'pointer input blocks the nudge').toBe(base)
  await page.keyboard.press('Shift')
  await emit(page, { type: 'REPETITIVE' })
  await page.waitForTimeout(400)
  expect(await nudges(page), 'key input blocks the nudge').toBe(base)
})

test('HabitWatch rules: UNDO snoozes 10 min; nudges stop; a second UNDO does not extend; Resume now ends it', async ({ page }) => {
  await open(page, { 'echo.habit.on': '1' })
  await quiet(page)
  const base = await nudges(page)
  await emit(page, { type: 'UNDO' })
  await expect(page.getByText('snoozed 10 min').first()).toBeVisible()
  const until = Number(await ls(page, 'echo.habit.snoozeUntil'))
  expect(until - Date.now()).toBeGreaterThan(9.5 * 60e3)
  await emit(page, { type: 'REPETITIVE' })
  await page.waitForTimeout(400)
  expect(await nudges(page), 'no nudge while snoozed').toBe(base)
  await page.waitForTimeout(1100)
  await emit(page, { type: 'UNDO' })
  await emit(page, { type: 'PUSH' }); await emit(page, { type: 'PUSH' })
  expect(Number(await ls(page, 'echo.habit.snoozeUntil')), 'double tap during a snooze does not restart or cancel it (0bacd2b)').toBe(until)
  await page.getByRole('button', { name: /resume now/i }).click()
  await quiet(page)
  await emit(page, { type: 'REPETITIVE' })
  await expect.poll(() => nudges(page)).toBe(base + 1)
})

test('HabitWatch rules: PUSH,PUSH snoozes only right after a nudge (not by accident)', async ({ page }) => {
  await open(page, { 'echo.habit.on': '1' })
  await quiet(page)
  await emit(page, { type: 'PUSH' }); await emit(page, { type: 'PUSH' })
  expect(Number((await ls(page, 'echo.habit.snoozeUntil')) ?? 0), 'PUSH pair with no recent nudge must not snooze').toBeLessThan(Date.now())
  await emit(page, { type: 'REPETITIVE' })
  await expect(page.getByText(/hands · /)).toBeVisible()
  await emit(page, { type: 'PUSH' }); await emit(page, { type: 'PUSH' })
  await expect(page.getByText('snoozed 10 min').first()).toBeVisible()
})

test('HabitWatch rules: Habit off means gestures do nothing', async ({ page }) => {
  await open(page)
  await quiet(page)
  await emit(page, { type: 'REPETITIVE' }); await emit(page, { type: 'UNDO' })
  await page.waitForTimeout(400)
  expect(await nudges(page)).toBe(0)
  expect(Number((await ls(page, 'echo.habit.snoozeUntil')) ?? 0)).toBe(0)
})

test('nudge works from another tab of the app (HabitWatch is app-wide): toast + bottom bar once an hour', async ({ page }) => {
  await open(page, { 'echo.habit.on': '1' })
  await page.goto('/#lock')
  await page.waitForLoadState('networkidle')
  await quiet(page)
  await emit(page, { type: 'REPETITIVE' })
  await expect(page.getByText(/hands · \d+ today/)).toBeVisible()
  await expect(page.locator('.hb-bar')).toHaveAttribute('aria-hidden', 'false')
  await page.screenshot({ path: join(SHOTS, 'habit-nudge-on-lock.png') })
  await page.waitForTimeout(9000) // past the cooldown
  await emit(page, { type: 'REPETITIVE' })
  await page.waitForTimeout(2500) // a second nudge in the same hour must not bring the bar back
  await expect(page.locator('.hb-bar')).toHaveAttribute('aria-hidden', 'true')
})

test('log keeps 7 days only and survives a corrupt log value', async ({ page }) => {
  const old = Date.now() - 9 * 864e5
  await open(page, { 'echo.habit.on': '1', 'echo.habit.log': JSON.stringify([old]) })
  await quiet(page)
  await emit(page, { type: 'REPETITIVE' })
  await expect.poll(() => nudges(page)).toBe(1)
  expect(JSON.parse((await ls(page, 'echo.habit.log')) ?? '[]')).not.toContain(old)
  const noise = watch(page)
  await page.evaluate(() => localStorage.setItem('echo.habit.log', '{not json'))
  await page.reload(); await page.waitForLoadState('networkidle')
  expect(await nudges(page)).toBe(0)
  expect(noise.pageErrors).toEqual([])
})
