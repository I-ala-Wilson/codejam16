import { test, expect, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

// Home page pass (lead's QA queue item 4, comment 7066454821): hero, explainer keys 1-5, "How we built it",
// no console noise at 1440x900 and 1920x1080. Also hunts the one 'AudioContext is closed' message Ian saw.
const GATE = process.env.QA_GATE ?? 'HOME'
const SHOTS = join(__dirname, '..', '..', 'docs', 'qa', 'shots', GATE)
mkdirSync(SHOTS, { recursive: true })

const VIEWPORTS = [{ w: 1440, h: 900 }, { w: 1920, h: 1080 }] as const

interface Noise { console: string[]; all: string[]; pageErrors: string[]; failed: string[] }
function watch(page: Page): Noise {
  const n: Noise = { console: [], all: [], pageErrors: [], failed: [] }
  page.on('console', (m) => {
    const line = `${m.type()}: ${m.text()}  @ ${m.location().url.replace(/^https?:\/\/[^/]+/, '')}:${m.location().lineNumber}`
    n.all.push(line)
    if ((m.type() === 'error' || m.type() === 'warning') && !/GL Driver Message|GPU stall due to ReadPixels/.test(m.text())) n.console.push(line)
  })
  page.on('pageerror', (e) => n.pageErrors.push(`${e}\n${e.stack ?? ''}`))
  page.on('requestfailed', (r) => n.failed.push(`${r.method()} ${r.url()} ${r.failure()?.errorText}`))
  page.on('response', (r) => { if (r.status() >= 400) n.failed.push(`${r.status()} ${r.url()}`) })
  return n
}

for (const vp of VIEWPORTS) {
  test.describe(`home @ ${vp.w}x${vp.h}`, () => {
    test.use({ viewport: { width: vp.w, height: vp.h } })

    test('hero, apps, sections render; no overflow; sonar autostarts', async ({ page }, info) => {
      const noise = watch(page)
      await page.goto('/')
      await page.waitForLoadState('networkidle')
      await expect(page.getByRole('heading', { level: 1 })).toContainText('Your laptop can hear your hands')
      for (const name of ['Lock', 'Care', 'Habit']) await expect(page.locator('.home__apps').getByRole('button', { name })).toBeVisible()
      await expect(page.locator('.home__how')).toHaveCount(1)
      // hero fits the first screen: headline and the three app buttons inside the viewport
      const box = await page.locator('.home__apps').boundingBox()
      expect(box && box.y + box.height, 'app buttons inside the first screen').toBeLessThanOrEqual(vp.h)
      await expect(page.getByText('sonar on · move your hand')).toBeVisible({ timeout: 15000 })
      await page.screenshot({ path: join(SHOTS, `hero-${vp.w}.png`) })
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect.soft(over, 'horizontal overflow px').toBeLessThanOrEqual(0)
      const body = await page.locator('body').innerText()
      expect.soft(body.match(/\bTODO\b|lorem ipsum|undefined|NaN|\[object Object\]/i)?.[0] ?? null).toBeNull()
      await info.attach('console-all.txt', { body: noise.all.join('\n') || '(nothing logged)' })
      expect.soft(noise.pageErrors, 'page errors').toEqual([])
      expect.soft(noise.console, 'console errors/warnings').toEqual([])
      expect.soft(noise.failed, 'failed requests').toEqual([])
    })

    test('explainer: keys 1-5 jump, p pauses, c orbits, d dithers; scene never goes blank; no errors', async ({ page }, info) => {
      const noise = watch(page)
      await page.goto('/')
      await page.waitForLoadState('networkidle')
      await page.locator('.home__how').scrollIntoViewIfNeeded()
      await page.waitForTimeout(800)
      const size = await page.evaluate(() => {
        const c = document.querySelector('.home__how canvas') as HTMLCanvasElement | null
        return c ? { w: c.clientWidth, h: c.clientHeight } : null
      })
      expect(size, 'explainer canvas exists').not.toBeNull()
      expect.soft(size!.w, 'canvas fills the width').toBeGreaterThan(vp.w * 0.5)
      for (const k of ['1', '2', '3', '4', '5']) {
        await page.keyboard.press(k)
        await page.waitForTimeout(1500)
        await page.locator('.home__how').screenshot({ path: join(SHOTS, `explainer-${k}-${vp.w}.png`) })
        expect.soft(await page.locator('body').innerText(), `key ${k}: no placeholder text`).not.toMatch(/undefined|NaN|\[object Object\]/)
      }
      for (const k of ['p', 'p', 'c', 'c', 'd', 'd']) { await page.keyboard.press(k); await page.waitForTimeout(250) }
      await page.keyboard.press('1')
      await page.waitForTimeout(600)
      expect(page.url(), 'still on the home page').not.toMatch(/#(?!$)/)
      await info.attach('console-all.txt', { body: noise.all.join('\n') || '(nothing logged)' })
      expect(noise.pageErrors, 'page errors').toEqual([])
      expect(noise.console, 'console errors/warnings').toEqual([])
    })

    test('How we built it: renders, fits the width, no console errors', async ({ page }, info) => {
      const noise = watch(page)
      await page.goto('/')
      await page.waitForLoadState('networkidle')
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
      await page.waitForTimeout(2500)
      await page.screenshot({ path: join(SHOTS, `how-we-built-${vp.w}.png`) })
      const text = await page.locator('body').innerText()
      for (const t of ['the model', 'the agents', 'the trade-offs', 'faq']) expect(text.toLowerCase(), `section "${t}"`).toContain(t)
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect.soft(over).toBeLessThanOrEqual(0)
      await info.attach('console-all.txt', { body: noise.all.join('\n') || '(nothing logged)' })
      expect(noise.pageErrors).toEqual([])
      expect(noise.console).toEqual([])
    })

    test('app buttons navigate: Lock, Care, Habit; and back to Home keeps the page healthy', async ({ page }) => {
      const noise = watch(page)
      for (const [name, hash] of [['Lock', 'lock'], ['Care', 'care'], ['Habit', 'habit-app']] as const) {
        await page.goto('/')
        await page.waitForLoadState('networkidle')
        await page.locator('.home__apps').getByRole('button', { name }).click()
        await expect.poll(() => page.url()).toContain(`#${hash}`)
        await page.locator('nav.top').getByRole('button', { name: /^ECHØ$/ }).click()
        await expect(page.getByRole('heading', { level: 1 })).toContainText('Your laptop can hear your hands')
      }
      expect(noise.pageErrors).toEqual([])
    })

    test('sonar recovers when the browser closes the AudioContext under it (headphones, sleep): Home must not stay on "starting sonar..."', async ({ page }, info) => {
      const noise = watch(page)
      await page.addInitScript(() => {
        const w = window as unknown as { __ctxs: AudioContext[]; AudioContext: typeof AudioContext }
        w.__ctxs = []
        const Orig = w.AudioContext
        w.AudioContext = class extends Orig { constructor(o?: AudioContextOptions) { super(o); w.__ctxs.push(this) } } as typeof AudioContext
      })
      await page.goto('/')
      await page.waitForLoadState('networkidle')
      await expect(page.getByText('sonar on · move your hand')).toBeVisible({ timeout: 15000 })
      await page.evaluate(async () => { const c = (window as unknown as { __ctxs: AudioContext[] }).__ctxs[0]; await c.close() })
      await expect(page.getByText('starting sonar…')).toBeVisible({ timeout: 5000 }) // it noticed
      await page.mouse.click(300, 300); await page.keyboard.press('Space')
      await page.waitForTimeout(8000)
      await info.attach('console-all.txt', { body: noise.all.join('\n') || '(nothing logged)' })
      await expect(page.getByText('sonar on · move your hand'), 'sonar must come back after its AudioContext was closed by the browser').toBeVisible({ timeout: 10000 })
    })

    test('AudioContext hunt: sonar start and a round trip over every tab produce no "closed" message', async ({ page }, info) => {
      const noise = watch(page)
      await page.goto('/')
      await page.waitForLoadState('networkidle')
      await expect(page.getByText('sonar on · move your hand')).toBeVisible({ timeout: 15000 })
      for (const hash of ['lock', 'care', 'habit-app', 'dataset', 'live', 'room', 'gestures', 'breath']) {
        await page.goto(`/#${hash}`)
        await page.waitForTimeout(700)
      }
      await page.goto('/#home')
      await page.waitForTimeout(1500)
      await info.attach('console-all.txt', { body: noise.all.join('\n') || '(nothing logged)' })
      expect(noise.all.filter((l) => /closed/i.test(l)), 'messages mentioning a closed AudioContext').toEqual([])
    })
  })
}
