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

let queue = Promise.resolve() // handle one message at a time: no LOCK/UNLOCK race
chrome.runtime.onMessageExternal.addListener((msg, _sender, reply) => {
  queue = queue.then(async () => {
    const st = await chrome.storage.local.get({ locked: false, sites: [] })
    if (msg.type === 'LOCK') {
      await chrome.storage.local.set({ locked: true, sites: msg.sites, progress: 0 })
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
