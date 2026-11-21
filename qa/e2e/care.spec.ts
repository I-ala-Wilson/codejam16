import { test, expect, chromium, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Care (bedside laptop) + Caregiver view, lead's QA queue item 3 (comment 7066454821), against Michael's 719fb1c.
// Gestures are played in through a wrapper on app/src/engine.ts (same trick as habit.spec.ts); events are read from the
// same-laptop BroadcastChannel('echo-events') that Care publishes to (contracts/events.md). What this proves: Care's
// rules and the events it emits. What it cannot prove: that the real sonar produces WAVE / UNDO at the right moments.
const GATE = process.env.QA_GATE ?? 'CARE'
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

interface Ev { app: string; kind: string; gesture: string | null; payload: Record<string, unknown>; device_id: string; at: number }
interface Noise { console: string[]; pageErrors: string[] }
function watch(page: Page): Noise {
  const n: Noise = { console: [], pageErrors: [] }
  page.on('console', (m) => { if (m.type() === 'error' && !/GL Driver/.test(m.text())) n.console.push(m.text()) })
  page.on('pageerror', (e) => n.pageErrors.push(String(e)))
  return n
}

async function open(page: Page, hash = 'care', opts: { micDenied?: boolean } = {}) {
  await page.route('**/src/engine.ts*', async (route) => {
    const res = await route.fetch()
    await route.fulfill({ response: res, body: (await res.text()) + HOOK })
  })
  await page.addInitScript((deny) => {
    const w = window as unknown as { __evs: unknown[] }
    w.__evs = []
    const ch = new BroadcastChannel('echo-events'); ch.onmessage = (m) => w.__evs.push(m.data)
    if (deny) navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('denied', 'NotAllowedError'))
  }, !!opts.micDenied)
  await page.goto(`/#${hash}`)
  await page.waitForLoadState('networkidle')
  await expect.poll(() => page.evaluate(() => (window as unknown as { __cbCount?: () => number }).__cbCount?.() ?? 0)).toBeGreaterThan(0)
}
const emit = (page: Page, g: { type: string; confidence?: number }) => page.evaluate((x) => (window as unknown as { __emit: (g: unknown) => void }).__emit(x), g)
const events = (page: Page) => page.evaluate(() => (window as unknown as { __evs: Ev[] }).__evs.slice())
const kinds = async (page: Page, app = 'care') => (await events(page)).filter((e) => e.app === app && e.kind !== 'activity').map((e) => e.kind)
const huge = (page: Page) => page.locator('.lk__huge')

test('care page: loads clean, legend lists the four messages and cancel, sonar starts', async ({ page }) => {
  const noise = watch(page)
  await open(page)
  await expect(page.getByRole('heading', { name: 'Wave for help.' })).toBeVisible()
  const legend = (await page.locator('.lk__legend').innerText()).toLowerCase()
  for (const s of ['wave = help', 'open/close = pain', 'push = yes', 'pull = no', 'double tap = cancel']) expect(legend, s).toContain(s)
  await expect(page.locator('canvas.lk__meter')).toBeVisible({ timeout: 15000 }) // only drawn once the sonar runs
  expect(await page.locator('body').innerText()).not.toMatch(/undefined|NaN|\[object|TODO/)
  await page.screenshot({ path: join(SHOTS, 'care-idle-1440.png'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(300)
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 'overflow at 390').toBeLessThanOrEqual(0)
  expect(noise.pageErrors).toEqual([])
  expect(noise.console).toEqual([])
})

for (const [gesture, kind] of [['WAVE', 'help'], ['OPEN_CLOSE', 'pain'], ['PUSH', 'yes'], ['PULL', 'no']] as const) {
  test(`${gesture} = ${kind}: full-screen message, countdown, one event with gesture and confidence`, async ({ page }) => {
    await open(page)
    await emit(page, { type: gesture, confidence: 0.87 })
    await expect(huge(page)).toHaveText(kind.toUpperCase())
    await expect(page.getByText('your caregiver has been alerted')).toBeVisible()
    await expect(page.getByText(/double tap to cancel · [1-5]/)).toBeVisible()
    const ev = (await events(page)).filter((e) => e.app === 'care' && e.kind === kind)
    expect(ev, `exactly one ${kind} event`).toHaveLength(1)
    expect(ev[0].gesture).toBe(gesture)
    expect(ev[0].payload.confidence).toBe(0.87)
    expect(ev[0].device_id, 'device id present').toBeTruthy()
    if (gesture === 'WAVE') await page.screenshot({ path: join(SHOTS, 'care-help.png') })
  })
}

test('UNDO within 5 s cancels: CANCELLED screen, one cancelled event naming the kind, back to idle after ~2.5 s', async ({ page }) => {
  await open(page)
  await emit(page, { type: 'WAVE' })
  await expect(huge(page)).toHaveText('HELP')
  await page.waitForTimeout(1200)
  await emit(page, { type: 'UNDO' })
  await expect(huge(page)).toHaveText('CANCELLED')
  await expect(page.getByText('the caregiver was told it was a false alarm')).toBeVisible()
  await page.screenshot({ path: join(SHOTS, 'care-cancelled.png') })
  const c = (await events(page)).filter((e) => e.kind === 'cancelled')
  expect(c).toHaveLength(1)
  expect(c[0].payload.cancelled_kind).toBe('help')
  expect(c[0].gesture).toBe('UNDO')
  await expect(page.getByRole('heading', { name: 'Wave for help.' })).toBeVisible({ timeout: 4500 })
  await emit(page, { type: 'UNDO' }) // nothing to cancel now
  await page.waitForTimeout(300)
  expect(await kinds(page)).toEqual(['help', 'cancelled'])
})

test('UNDO after the 5 s window does not cancel; the screen offers tap to dismiss; a click dismisses it', async ({ page }) => {
  await open(page)
  await emit(page, { type: 'WAVE' })
  await page.waitForTimeout(5400)
  await expect(page.getByText('tap to dismiss')).toBeVisible()
  await emit(page, { type: 'UNDO' })
  await page.waitForTimeout(300)
  await expect(huge(page)).toHaveText('HELP')
  expect(await kinds(page)).toEqual(['help'])
  await page.locator('.lk--invert').click()
  await expect(page.getByRole('heading', { name: 'Wave for help.' })).toBeVisible()
})

test('double PUSH inside the window also cancels, and no stray "yes" is sent (Michael 719fb1c)', async ({ page }) => {
  await open(page)
  await emit(page, { type: 'WAVE' })
  await page.waitForTimeout(500)
  await emit(page, { type: 'PUSH' })
  await page.waitForTimeout(300)
  await emit(page, { type: 'PUSH' })
  await expect(huge(page)).toHaveText('CANCELLED')
  await page.waitForTimeout(2000) // longer than the 1.5 s pending-push delay
  expect(await kinds(page)).toEqual(['help', 'cancelled'])
})

test('a single PUSH after a help call becomes "yes" after ~1.5 s and replaces the HELP screen', async ({ page }) => {
  await open(page)
  await emit(page, { type: 'WAVE' })
  await page.waitForTimeout(400)
  await emit(page, { type: 'PUSH' })
  await expect(huge(page)).toHaveText('YES', { timeout: 3000 })
  expect(await kinds(page)).toEqual(['help', 'yes'])
})

test('five WAVEs in half a second do not flood the caregiver with help events', async ({ page }) => {
  test.fail(true, 'P3: Care does not dedupe a WAVE while HELP is up; every WAVE re-sends help and restarts the 5 s cancel window. Real engine rate unknown (human test). Remove once deduped.')
  const noise = watch(page)
  await open(page)
  for (let i = 0; i < 5; i++) { await emit(page, { type: 'WAVE' }); await page.waitForTimeout(100) }
  expect(noise.pageErrors).toEqual([])
  const n = (await kinds(page)).filter((k) => k === 'help').length
  expect(n, `5 waves in 0.5 s produced ${n} help events; one help call should not spam the caregiver`).toBeLessThanOrEqual(2)
})

test('HOLD, REPETITIVE and unknown gestures do nothing', async ({ page }) => {
  await open(page)
  await emit(page, { type: 'HOLD' }); await emit(page, { type: 'REPETITIVE' }); await emit(page, { type: 'WAVE_X' })
  await page.waitForTimeout(300)
  expect(await kinds(page)).toEqual([])
  await expect(page.getByRole('heading', { name: 'Wave for help.' })).toBeVisible()
})

test('caregiver tab in the same browser gets the help alert, then the cancel clears it; feed reads right', async ({ page, context }) => {
  await open(page)
  const cg = await context.newPage()
  await cg.goto('/#caregiver'); await cg.waitForLoadState('networkidle')
  await expect(cg.getByText('Waiting')).toBeVisible()
  await emit(page, { type: 'WAVE' })
  await expect(cg.locator('.lk__huge')).toHaveText('HELP')
  await cg.screenshot({ path: join(SHOTS, 'caregiver-alert.png') })
  await emit(page, { type: 'UNDO' })
  await expect(cg.getByText('Watching')).toBeVisible()
  await expect(cg.locator('.cg__row').first()).toContainText('help cancelled (false alarm)')
  await emit(page, { type: 'OPEN_CLOSE' })
  await expect(cg.locator('.lk__huge')).toHaveText('PAIN')
  await emit(page, { type: 'UNDO' })
  await expect(cg.getByText('Watching')).toBeVisible()
  await expect(cg.locator('.cg__row').first()).toContainText('pain cancelled')
  await cg.screenshot({ path: join(SHOTS, 'caregiver-feed.png'), fullPage: true })
})

test('activity every 10 s with level 0..1 and the gesture count of that window', async ({ page }) => {
  await open(page)
  await emit(page, { type: 'PUSH' }) // counts as one gesture in the first window
  await page.waitForTimeout(12000)
  const act = (await events(page)).filter((e) => e.kind === 'activity')
  expect(act.length, 'one activity event after ~12 s').toBeGreaterThanOrEqual(1)
  expect(act[0].payload.level, 'level in 0..1').toBeGreaterThanOrEqual(0)
  expect(act[0].payload.level as number).toBeLessThanOrEqual(1)
  expect(act[0].payload.gestures, 'gesture count in window').toBe(1)
})

// A silent fake microphone: the default Chromium fake mic beeps, which the sonar reads as constant movement.
const SILENCE = join(tmpdir(), 'qa-silence-48k.wav')
{
  const n = 48000 * 5, b = Buffer.alloc(44 + n * 2)
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22)
  b.writeUInt32LE(48000, 24); b.writeUInt32LE(96000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40)
  writeFileSync(SILENCE, b)
}
test('silent room: inactivity alert is sent once after 30 s with no movement, and the status line says so', async ({ baseURL }) => {
  test.setTimeout(90_000)
  // Own browser: the silent fake mic is a launch flag, and the default Chromium fake mic beeps.
  const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', `--use-file-for-fake-audio-capture=${SILENCE}`] })
  try {
    const ctx = await browser.newContext({ baseURL, permissions: ['microphone'] })
    const page = await ctx.newPage()
    await open(page)
    await page.waitForTimeout(34000)
    const inactive = (await events(page)).filter((e) => e.kind === 'inactive')
    const seconds = inactive.map((e) => e.payload.seconds)
    expect(inactive.length, `inactive events after ~34 s of silence (seconds=${JSON.stringify(seconds)})`).toBe(1)
    expect(Number(seconds[0])).toBeGreaterThanOrEqual(30)
    await expect(page.getByText(/no movement for \d+s · caregiver told/)).toBeVisible()
    await page.screenshot({ path: join(SHOTS, 'care-inactive.png') })
    await page.waitForTimeout(4000)
    expect((await events(page)).filter((e) => e.kind === 'inactive'), 'still only one inactive event').toHaveLength(1)
  } finally { await browser.close() }
})

test('mic refused: Care says so (Start listening), does not crash, and does not pretend to be watching', async ({ page }) => {
  const noise = watch(page)
  test.setTimeout(60_000)
  test.fail(true, 'P2: Care sends activity events every 10 s although the sonar never started; contracts/events.md says "while running". Caregiver sees a live bed with level 0 and no sensor-offline signal. Remove once fixed.')
  await open(page, 'care', { micDenied: true })
  await expect(page.getByRole('button', { name: /start listening/i })).toBeVisible({ timeout: 15000 })
  await page.screenshot({ path: join(SHOTS, 'care-no-mic.png') })
  expect(noise.pageErrors).toEqual([])
  await page.waitForTimeout(11000)
  const act = (await events(page)).filter((e) => e.kind === 'activity')
  // contracts/events.md: activity is sent "every 10 s while running". A laptop whose sonar never started
  // must not look alive to the caregiver, and nothing tells the caregiver the bedside sensor is off.
  expect(act, 'activity events sent although the sonar is not running').toEqual([])
})
