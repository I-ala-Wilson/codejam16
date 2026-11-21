import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test'
import { resolve } from 'node:path'

// Contract under test: contracts/extension.md (LOCK / UNLOCK / STATUS over externally_connectable).
const EXT_DIR = resolve(process.env.EXT_DIR ?? resolve(__dirname, '..', '..', 'extension'))
const ORIGIN = 'http://localhost:5199'

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

test('STATUS after fresh unlock matches the contract shape', async () => {
  const r = (await send({ type: 'STATUS' })) as { locked: boolean; sites: string[]; until: number | null }
  expect(r.locked).toBe(false)
  expect(Array.isArray(r.sites)).toBe(true)
  expect(r.until === null || typeof r.until === 'number').toBe(true) // contract: number|null
})

test('LOCK replies {ok:true, locked:true} and STATUS reflects the sites', async () => {
  const r = await send({ type: 'LOCK', sites: ['youtube.com', 'tiktok.com'], appUrl: `${ORIGIN}/#lock` })
  expect(r).toEqual({ ok: true, locked: true })
  const s = (await send({ type: 'STATUS' })) as { locked: boolean; sites: string[]; until: number | null }
  expect(s).toEqual({ locked: true, sites: ['youtube.com', 'tiktok.com'], until: null })
})

// Contract history: up to 8048c98 UNLOCK meant "off for 30 min" (until = epoch ms). Since 643eb6c the
// contract says "off until the next LOCK (no expiry)" and replies until:null. Tests follow the current contract.
test('UNLOCK replies {ok:true, locked:false, until:null} (no expiry, per current contract)', async () => {
  await send({ type: 'LOCK', sites: ['youtube.com'] })
  const r = await send({ type: 'UNLOCK' })
  expect(r).toEqual({ ok: true, locked: false, until: null })
})

test('locked site redirects to blocked.html with the exact copy and a link to appUrl', async () => {
  await send({ type: 'LOCK', sites: ['youtube.com'], appUrl: `${ORIGIN}/#lock` })
  for (const host of ['https://www.youtube.com/', 'https://m.youtube.com/', 'https://youtube.com/']) {
    const p = await ctx.newPage()
    await p.goto(host, { waitUntil: 'commit' }).catch(() => undefined)
    await p.waitForURL(/blocked\.html/, { timeout: 5000 }).catch(() => undefined)
    expect.soft(p.url(), `${host} is blocked`).toContain(`${extId}/blocked.html`)
    await p.close()
  }
  const p = await ctx.newPage()
  await p.goto(`chrome-extension://${extId}/blocked.html`)
  // Copy is split across elements ("Locked by Echo." / "Ask a parent."), so match across the break.
  await expect(p.locator('body')).toContainText(/Locked by Echo\./)
  await expect(p.locator('body')).toContainText(/Ask a parent\./)
  // Contract: link is appUrl?unlock=1&return=<original URL>; opened without a hash there is no return param.
  const href = (await p.locator('#open').getAttribute('href')) ?? ''
  const u = new URL(href)
  expect(u.origin + u.pathname + u.hash).toBe(`${ORIGIN}/#lock`)
  expect(u.searchParams.get('unlock')).toBe('1')
  await p.close()
})

test('youtu.be short links are blocked while youtube.com is locked (kid bypass)', async () => {
  await send({ type: 'LOCK', sites: ['youtube.com'] })
  const p = await ctx.newPage()
  await p.goto('https://youtu.be/dQw4w9WgXcQ', { waitUntil: 'commit' }).catch(() => undefined)
  await p.waitForURL(/blocked\.html/, { timeout: 4000 }).catch(() => undefined)
  expect(p.url(), 'youtu.be should not bypass the lock').toContain('blocked.html')
  await p.close()
})

test('UNLOCK stops blocking immediately', async () => {
  await send({ type: 'LOCK', sites: ['youtube.com'] })
  await send({ type: 'UNLOCK' })
  const p = await ctx.newPage()
  await p.goto('https://www.youtube.com/', { waitUntil: 'commit' }).catch(() => undefined)
  await p.waitForTimeout(800)
  expect(p.url()).not.toContain('blocked.html')
  await p.close()
})

test('double-clicked LOCK (two concurrent messages) both succeed and the lock still works', async () => {
  const [a, b] = await Promise.all([
    send({ type: 'LOCK', sites: ['youtube.com', 'tiktok.com'] }),
    send({ type: 'LOCK', sites: ['youtube.com', 'tiktok.com'] }),
  ])
  expect(a, 'first reply').toEqual({ ok: true, locked: true })
  expect(b, 'second reply').toEqual({ ok: true, locked: true })
  const s = (await send({ type: 'STATUS' })) as { locked: boolean }
  expect(s.locked).toBe(true)
})

test('LOCK then UNLOCK sent back-to-back leaves storage and rules consistent', async () => {
  await Promise.all([send({ type: 'LOCK', sites: ['youtube.com'] }), send({ type: 'UNLOCK' })])
  const s = (await send({ type: 'STATUS' })) as { locked: boolean }
  const p = await ctx.newPage()
  await p.goto('https://www.youtube.com/', { waitUntil: 'commit' }).catch(() => undefined)
  await p.waitForTimeout(800)
  const blocked = p.url().includes('blocked.html')
  await p.close()
  expect(blocked, `STATUS.locked=${s.locked} must agree with whether the site is actually blocked`).toBe(s.locked)
})

test('unknown message type replies {ok:false, error}', async () => {
  const r = (await send({ type: 'NOPE' })) as { ok: boolean; error: string }
  expect(r.ok).toBe(false)
  expect(typeof r.error).toBe('string')
})

test('malformed LOCK (sites not an array) gets an error reply, not silence, and does not corrupt STATUS', async () => {
  const r = await send({ type: 'LOCK', sites: 'youtube.com' })
  expect.soft(r, 'must reply with ok:false rather than hang').toMatchObject({ ok: false })
  const s = (await send({ type: 'STATUS' })) as { locked: boolean; sites: unknown }
  expect.soft(Array.isArray(s.sites), 'STATUS.sites is still an array').toBe(true)
})

test('malformed LOCK (missing sites) gets an error reply, not silence', async () => {
  const r = await send({ type: 'LOCK' })
  expect(r, 'must reply with ok:false rather than hang').toMatchObject({ ok: false })
})

test('message with no type / null body gets a reply', async () => {
  const r1 = await send({})
  expect.soft(r1, '{} -> ok:false').toMatchObject({ ok: false })
  const r2 = await send(null)
  expect.soft(r2, 'null -> reply').not.toHaveProperty('__lastError')
})

test('huge sites list (2000 entries) does not hang or crash the worker', async () => {
  const sites = Array.from({ length: 2000 }, (_, i) => `site${i}.example`)
  const r = await send({ type: 'LOCK', sites })
  expect(r).toMatchObject({ ok: true })
})

test('hostile appUrl (javascript:) is not turned into a live link on blocked.html', async () => {
  await send({ type: 'LOCK', sites: ['youtube.com'], appUrl: 'javascript:alert(1)' })
  const p = await ctx.newPage()
  await p.goto(`chrome-extension://${extId}/blocked.html`)
  const href = await p.locator('#open').getAttribute('href')
  expect(href ?? '', 'href must be http(s) or absent').not.toMatch(/^javascript:/i)
  await p.close()
})

test('lock persists through a service-worker restart (state not held only in memory)', async () => {
  await send({ type: 'LOCK', sites: ['youtube.com'] })
  const sw = ctx.serviceWorkers().find((w) => w.url().includes(extId))
  await sw?.evaluate(() => (self as unknown as { close?: () => void }).close?.()).catch(() => undefined)
  await new Promise((r) => setTimeout(r, 500))
  const s = (await send({ type: 'STATUS' })) as { locked: boolean; sites: string[] }
  expect(s.locked).toBe(true)
  expect(s.sites).toEqual(['youtube.com'])
})

async function urlAfterVisit(url: string): Promise<string> {
  const p = await ctx.newPage()
  await p.goto(url, { waitUntil: 'commit' }).catch(() => undefined)
  await p.waitForTimeout(1200)
  const u = p.url()
  await p.close()
  return u
}

test('free-text site entered as a full URL either blocks the site or is rejected, never "LOCKED" with nothing blocked', async () => {
  // Lock page input is free text split on commas; a parent may well type "https://www.youtube.com".
  const r = (await send({ type: 'LOCK', sites: ['https://www.youtube.com'] })) as { ok?: boolean }
  const after = await urlAfterVisit('https://www.youtube.com/')
  const blocked = after.includes('blocked.html')
  expect(blocked || r.ok === false, `reply ok:${r.ok} but youtube.com ${blocked ? 'is' : 'is NOT'} blocked (landed on ${after.slice(0, 40)})`).toBe(true)
})

test('a tab already open on a site is blocked when LOCK arrives (not only new navigations)', async () => {
  const open = await ctx.newPage()
  await open.route('https://www.kids.test/**', (r) => r.fulfill({ contentType: 'text/html', body: '<title>video</title>playing' }))
  await open.goto('https://www.kids.test/watch')
  await send({ type: 'LOCK', sites: ['kids.test'] })
  await open.waitForTimeout(1000)
  const stillPlaying = (await open.locator('body').innerText().catch(() => '')).includes('playing')
  await open.close()
  expect(stillPlaying, 'existing tab keeps playing after LOCK').toBe(false)
})
