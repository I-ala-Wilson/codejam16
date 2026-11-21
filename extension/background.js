// Echo Lock, per contracts/extension.md. Secret mode: a locked site keeps its real URL but shows a fake browser
// connection error (veil.js, injected at document_start), so nobody can tell it is locked. The Echo app tab
// listens to the sonar and sends LOCK / UNLOCK when it hears the password, and PROGRESS for the tiny dots.
const SCRIPT_ID = 'echo-veil'
const patterns = (sites) => sites.flatMap((s) => [`*://${s}/*`, `*://*.${s}/*`])

async function applyVeil(sites) {
  const old = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] })
  if (old.length) await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] })
  if (!sites.length) return
  await chrome.scripting.registerContentScripts([{ id: SCRIPT_ID, matches: patterns(sites), js: ['veil.js'], runAt: 'document_start', allFrames: false, persistAcrossSessions: true }])
  // tabs already open on a locked site fall over too
  for (const t of await chrome.tabs.query({ url: patterns(sites) })) chrome.tabs.reload(t.id)
}

// v0.1 redirected locked sites to blocked.html with dynamic rules; clear any left over so nothing points there
chrome.runtime.onInstalled.addListener(async () => {
  const old = await chrome.declarativeNetRequest.getDynamicRules()
  if (old.length) await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: old.map((r) => r.id) })
  const { locked, sites } = await chrome.storage.local.get({ locked: false, sites: [] })
  await applyVeil(locked ? sites : [])
})

// A veiled page just loaded: make sure an Echo app tab is open and its sonar is running, with no click.
// The app tab is opened pinned and in the background, then poked to start the sonar itself.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'VEIL_UP') ensureListener()
})
async function ensureListener() {
  const { appUrl } = await chrome.storage.local.get({ appUrl: null })
  if (!appUrl) return
  let tab = (await chrome.tabs.query({})).find((t) => t.url?.startsWith(`${appUrl}/`))
  if (!tab) {
    tab = await chrome.tabs.create({ url: `${appUrl}/`, active: false, pinned: true })
    return // the app autostarts its sonar on load when a password is set
  }
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: () => window.echoAutostart?.() }).catch(() => {})
}

let queue = Promise.resolve() // handle one message at a time: no LOCK/UNLOCK race
chrome.runtime.onMessageExternal.addListener((msg, _sender, reply) => {
  queue = queue.then(async () => {
    const st = await chrome.storage.local.get({ locked: false, sites: [] })
    if (msg.type === 'LOCK') {
      // validate before touching state: sites must be a list of bare hosts, appUrl only our own app origins
      const sites = Array.isArray(msg.sites) ? msg.sites.filter((x) => typeof x === 'string' && /^[a-z0-9.-]+$/i.test(x)) : null
      const appOk = (u) => { try { const h = new URL(u); return (h.protocol === 'http:' && h.hostname === 'localhost') || (h.protocol === 'https:' && h.hostname.endsWith('.vercel.app')) } catch { return false } }
      if (!sites || !sites.length) { reply({ ok: false, error: 'LOCK needs sites: [host, ...]' }); return }
      msg = { ...msg, sites, appUrl: msg.appUrl && appOk(msg.appUrl) ? msg.appUrl : null }
      await chrome.storage.local.set({ locked: true, sites: msg.sites, progress: 0, appUrl: msg.appUrl || null })
      await applyVeil(msg.sites); reply({ ok: true, locked: true })
    } else if (msg.type === 'UNLOCK') {
      // stays unlocked until the next LOCK (no expiry); veiled tabs reload themselves when they see locked=false
      await chrome.storage.local.set({ locked: false, progress: 0 })
      await applyVeil([]); reply({ ok: true, locked: false, until: null })
    } else if (msg.type === 'PROGRESS') {
      await chrome.storage.local.set({ progress: Math.max(0, Math.min(8, msg.n | 0)) }); reply({ ok: true })
    } else if (msg.type === 'STATUS') {
      reply({ locked: st.locked, sites: st.sites, until: null })
    } else reply({ ok: false, error: 'unknown type' })
  }).catch((e) => reply({ ok: false, error: String(e) }))
  return true
})
