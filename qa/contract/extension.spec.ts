import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test'
import { resolve } from 'node:path'

// Contract under test: contracts/extension.md at extension v0.2 (secret veil).
// LOCK / UNLOCK / PROGRESS / STATUS over externally_connectable; locked sites keep their URL but veil.js paints a fake
// "This site can't be reached" page; PROGRESS n shows n tiny dots; UNLOCK reloads veiled tabs into the real site.
const EXT_DIR = resolve(process.env.EXT_DIR ?? resolve(__dirname, '..', '..', 'extension'))
const ORIGIN = 'http://localhost:5199'
const FAKE_ERROR = /This site can.t be reached/

let ctx: BrowserContext
let page: Page
let extId = ''

test.beforeAll(async () => {
  ctx = await chromium.launchPersistentContext('', {
    channel: 'chromium', // new headless: extensions only load here, not in the headless shell
    args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`],
  })
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'))
  extId = new URL(sw.url()).host
  // Any localhost page may talk to the extension; serve a blank one so no dev server is needed.
  await ctx.route(`${ORIGIN}/**`, (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>qa</title>' }))
  page = await ctx.newPage()
  await page.goto(`${ORIGIN}/`)
})

test.afterAll(async () => { await ctx.close() })

type Reply = Record<string, unknown> | null | { __lastError: string }

async function send(msg: unknown): Promise<Reply> {
  return page.evaluate(
    ([id, m]) => new Promise<Reply>((res) => {
      const t = setTimeout(() => res({ __lastError: 'TIMEOUT (no reply in 3 s)' }), 3000)
      chrome.runtime.sendMessage(id as string, m, (reply) => {
        clearTimeout(t)
        res(chrome.runtime.lastError ? { __lastError: chrome.runtime.lastError.message ?? 'unknown' } : reply)
      })
    }),
    [extId, msg] as const,
  )
}

test.beforeEach(async () => { await send({ type: 'UNLOCK' }) })

type Status = { locked: boolean; sites: string[]; until: number | null }

// Open a url and wait for either the veil or the real page to settle.
async function visit(url: string): Promise<Page> {
  const p = await ctx.newPage()
  // 8 s cap: Playwright's default navigation timeout is unlimited, and a dead look-alike host would eat the whole test.
  await p.goto(url, { waitUntil: 'commit', timeout: 8000 }).catch(() => undefined)
  await p.waitForTimeout(1500)
  return p
}
// evaluate, not locator.innerText: a page that failed to load (DNS error page, no <body>) must answer "not veiled" at once.
const veiled = async (p: Page) => FAKE_ERROR.test(await p.evaluate(() => document.body?.innerText ?? '').catch(() => ''))

async function dynamicRuleCount(): Promise<number> {
  const sw = ctx.serviceWorkers().find((w) => w.url().includes(extId)) ?? (await ctx.waitForEvent('serviceworker'))
  return sw.evaluate(async () => (await chrome.declarativeNetRequest.getDynamicRules()).length)
}

// ---------------------------------------------------------------- message contract

test('STATUS after fresh unlock matches the contract shape', async () => {
  const r = (await send({ type: 'STATUS' })) as Status
  expect(r.locked).toBe(false)
  expect(Array.isArray(r.sites)).toBe(true)
  expect(r.until === null || typeof r.until === 'number').toBe(true)
})

test('LOCK replies {ok:true, locked:true} and STATUS reflects the sites', async () => {
  const r = await send({ type: 'LOCK', sites: ['youtube.com', 'tiktok.com'], appUrl: ORIGIN })
  expect(r).toEqual({ ok: true, locked: true })
  expect(await send({ type: 'STATUS' })).toEqual({ locked: true, sites: ['youtube.com', 'tiktok.com'], until: null })
})

test('UNLOCK replies {ok:true, locked:false, until:null} (no expiry)', async () => {
  await send({ type: 'LOCK', sites: ['youtube.com'] })
  expect(await send({ type: 'UNLOCK' })).toEqual({ ok: true, locked: false, until: null })
  expect(((await send({ type: 'STATUS' })) as Status).locked).toBe(false)
})

test('PROGRESS replies {ok:true}', async () => {
  await send({ type: 'LOCK', sites: ['youtube.com'] })
  expect(await send({ type: 'PROGRESS', n: 2 })).toEqual({ ok: true })
})

test('unknown message type replies {ok:false, error}', async () => {
  const r = (await send({ type: 'NOPE' })) as { ok: boolean; error: string }
  expect(r.ok).toBe(false)
  expect(typeof r.error).toBe('string')
})

// ---------------------------------------------------------------- DIRECT 7064730040: the secret lock, end to end

test('LOCK: youtube.com keeps its URL and shows the fake "can\'t be reached" page, no YouTube content', async () => {
  await send({ type: 'LOCK', sites: ['youtube.com', 'tiktok.com'], appUrl: ORIGIN })
  for (const host of ['https://www.youtube.com/', 'https://m.youtube.com/', 'https://youtube.com/']) {
    const p = await visit(host)
    expect.soft(p.url(), `${host} keeps a youtube.com URL (nothing says "locked")`).toMatch(/^https:\/\/(www\.|m\.)?youtube\.com\//)
    expect.soft(await veiled(p), `${host} shows the fake error`).toBe(true)
    const body = await p.locator('body').innerText()
    expect.soft(body, 'looks like a browser error').toContain('ERR_CONNECTION_REFUSED')
    expect.soft(body, 'no sign of Echo').not.toMatch(/echo|lock/i)
    expect.soft(await p.locator('ytd-app, #masthead').count(), 'no YouTube DOM').toBe(0)
    await p.close()
  }
})

test('LOCK: no dots at rest; PROGRESS n=2 shows 2 tiny dots, n=0 clears them (live, no reload)', async () => {
  await send({ type: 'LOCK', sites: ['youtube.com'], appUrl: ORIGIN })
  const p = await visit('https://www.youtube.com/')
  expect(await veiled(p)).toBe(true)
  await expect(p.locator('#dots i')).toHaveCount(0)
  await send({ type: 'PROGRESS', n: 2 })
  await expect(p.locator('#dots i')).toHaveCount(2, { timeout: 3000 })
  const box = await p.locator('#dots i').first().boundingBox()
  expect(box && box.width <= 4 && box.height <= 4, 'dots are tiny (<=4 px)').toBe(true)
  await send({ type: 'PROGRESS', n: 0 })
  await expect(p.locator('#dots i')).toHaveCount(0, { timeout: 3000 })
  await p.close()
})

test('PROGRESS out of range is clamped, not a crash (n=99 -> 8 dots, n=-3 -> 0, n=NaN -> 0)', async () => {
  await send({ type: 'LOCK', sites: ['youtube.com'], appUrl: ORIGIN })
  const p = await visit('https://www.youtube.com/')
  for (const [n, want] of [[99, 8], [-3, 0], ['x', 0]] as const) {
    expect(await send({ type: 'PROGRESS', n })).toEqual({ ok: true })
    await expect(p.locator('#dots i')).toHaveCount(want, { timeout: 3000 })
  }
  await p.close()
})

test('UNLOCK: a veiled tab reloads into the real YouTube by itself', async () => {
  await send({ type: 'LOCK', sites: ['youtube.com'], appUrl: ORIGIN })
  const p = await visit('https://www.youtube.com/')
  expect(await veiled(p), 'precondition: veiled').toBe(true)
  await send({ type: 'UNLOCK' })
  // The veil's own title is the hostname ("www.youtube.com"), so wait for the real page's DOM, not a title match.
  await expect.poll(() => p.evaluate(() => document.querySelectorAll('ytd-app, #masthead, ytd-masthead').length).catch(() => 0), { timeout: 20000, message: 'real YouTube DOM is back after UNLOCK' }).toBeGreaterThan(0)
  expect(await veiled(p), 'fake error gone after UNLOCK').toBe(false)
  await p.close()
})

test('an already-open youtube tab falls over (reloads into the veil) when LOCK arrives', async () => {
  const p = await visit('https://www.youtube.com/')
  expect(await veiled(p), 'precondition: real YouTube while unlocked').toBe(false)
  await send({ type: 'LOCK', sites: ['youtube.com'], appUrl: ORIGIN })
  await expect.poll(() => veiled(p), { timeout: 10000 }).toBe(true)
  expect(p.url()).toMatch(/youtube\.com/)
  await p.close()
})

test('old blocked.html redirect rules are gone: none registered, youtube loads normally while unlocked', async () => {
  expect(await dynamicRuleCount(), 'no declarativeNetRequest dynamic rules').toBe(0)
  const p = await visit('https://www.youtube.com/')
  expect(p.url(), 'no redirect to the old page').not.toContain('blocked.html')
  expect(await veiled(p)).toBe(false)
  await p.close()
})

// Not automated: an unpacked extension cannot be reloaded under Playwright (chrome.runtime.reload() never yields a new
// worker here), so "background.js onInstalled clears v0.1 dynamic rules" was checked by reading the code only.

test('lock survives a service-worker restart: STATUS and the veil both persist', async () => {
  await send({ type: 'LOCK', sites: ['youtube.com'], appUrl: ORIGIN })
  const sw = ctx.serviceWorkers().find((w) => w.url().includes(extId))
  await sw?.evaluate(() => (self as unknown as { close?: () => void }).close?.()).catch(() => undefined)
  await new Promise((r) => setTimeout(r, 800))
  const s = (await send({ type: 'STATUS' })) as Status
  expect(s.locked).toBe(true)
  expect(s.sites).toEqual(['youtube.com'])
  const p = await visit('https://www.youtube.com/')
  expect(await veiled(p), 'veil still applies').toBe(true)
  await p.close()
})

test('only the locked site is veiled: look-alike hosts and other sites load normally', async () => {
  await send({ type: 'LOCK', sites: ['youtube.com'], appUrl: ORIGIN })
  // notyoutube.com is a parked host that hangs for a minute, so serve the look-alikes locally; match patterns see only the URL.
  const lookalikes = ['https://notyoutube.com/', 'https://youtube.com.example.net/', 'https://example.com/']
  for (const url of lookalikes) await ctx.route(url, (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>real page</title>real content' }))
  for (const url of lookalikes) {
    const p = await visit(url)
    expect.soft(await veiled(p), `${url} must not be veiled`).toBe(false)
    expect.soft(await p.evaluate(() => document.body?.innerText ?? ''), `${url} shows its own content`).toContain('real content')
    await p.close()
  }
  for (const url of lookalikes) await ctx.unroute(url)
})

test('youtu.be short links are veiled while youtube.com is locked (kid bypass)', async () => {
  await send({ type: 'LOCK', sites: ['youtube.com'], appUrl: ORIGIN })
  const p = await visit('https://youtu.be/dQw4w9WgXcQ')
  expect(await veiled(p), 'youtu.be redirects to youtube.com and must hit the veil').toBe(true)
  await p.close()
})

// ---------------------------------------------------------------- robustness

test('double-clicked LOCK (two concurrent messages) both reply and the lock holds', async () => {
  const [a, b] = await Promise.all([
    send({ type: 'LOCK', sites: ['youtube.com', 'tiktok.com'], appUrl: ORIGIN }),
    send({ type: 'LOCK', sites: ['youtube.com', 'tiktok.com'], appUrl: ORIGIN }),
  ])
  expect(a, 'first reply').toEqual({ ok: true, locked: true })
  expect(b, 'second reply').toEqual({ ok: true, locked: true })
  expect(((await send({ type: 'STATUS' })) as Status).locked).toBe(true)
})

test('LOCK then UNLOCK sent back-to-back leave STATUS and the veil consistent', async () => {
  await Promise.all([send({ type: 'LOCK', sites: ['youtube.com'], appUrl: ORIGIN }), send({ type: 'UNLOCK' })])
  const s = (await send({ type: 'STATUS' })) as Status
  const p = await visit('https://www.youtube.com/')
  const isVeiled = await veiled(p)
  await p.close()
  expect(isVeiled, `STATUS.locked=${s.locked} must agree with whether the site is actually veiled`).toBe(s.locked)
})

test('malformed LOCK (sites not an array) gets ok:false and does not corrupt STATUS', async () => {
  const r = await send({ type: 'LOCK', sites: 'youtube.com' })
  expect.soft(r, 'must reply ok:false').toMatchObject({ ok: false })
  const s = (await send({ type: 'STATUS' })) as Status
  expect.soft(Array.isArray(s.sites), 'STATUS.sites is still an array').toBe(true)
})

test('malformed LOCK (missing sites) gets ok:false and leaves the extension unlocked', async () => {
  const r = await send({ type: 'LOCK' })
  expect.soft(r, 'must reply ok:false').toMatchObject({ ok: false })
  const s = (await send({ type: 'STATUS' })) as Status
  expect.soft(s.locked, 'a rejected LOCK must not leave locked:true with no sites').toBe(false)
})

test('message with no type / null body gets a reply', async () => {
  expect.soft(await send({}), '{} -> ok:false').toMatchObject({ ok: false })
  expect.soft(await send(null), 'null -> reply').not.toHaveProperty('__lastError')
})

test('huge sites list (2000 entries) does not hang the worker', async () => {
  const sites = Array.from({ length: 2000 }, (_, i) => `site${i}.example`)
  const r = await send({ type: 'LOCK', sites, appUrl: ORIGIN })
  expect(r).toMatchObject({ ok: true })
})

test('free-text site entered as a full URL either veils the site or is rejected, never "locked" with nothing blocked', async () => {
  const r = (await send({ type: 'LOCK', sites: ['https://www.youtube.com'], appUrl: ORIGIN })) as { ok?: boolean }
  const p = await visit('https://www.youtube.com/')
  const isVeiled = await veiled(p)
  await p.close()
  expect(isVeiled || r.ok === false, `reply ok:${r.ok} but youtube.com ${isVeiled ? 'is' : 'is NOT'} veiled`).toBe(true)
})

test('empty-string site is rejected or harmless (must not veil everything)', async () => {
  const r = await send({ type: 'LOCK', sites: [''], appUrl: ORIGIN })
  const p = await visit('https://example.com/')
  const everything = await veiled(p)
  await p.close()
  expect(everything, `reply ${JSON.stringify(r)}; example.com must not be veiled`).toBe(false)
})

test('hostile appUrl is not stored as a place the extension will open tabs to', async () => {
  // veil.js pokes the extension on every veiled load; ensureListener opens a pinned tab at the stored appUrl.
  await send({ type: 'LOCK', sites: ['youtube.com'], appUrl: 'https://example.org' })
  const before = ctx.pages().length
  const p = await visit('https://www.youtube.com/')
  await new Promise((r) => setTimeout(r, 1500))
  const opened = ctx.pages().filter((x) => /example\.org/.test(x.url()))
  for (const x of ctx.pages()) if (x !== page && /example\.org/.test(x.url())) await x.close().catch(() => undefined)
  await p.close()
  expect(opened.length, `a page that sent LOCK controls which site the extension opens pinned in the background (pages ${before} -> ${before + opened.length})`).toBe(0)
})
