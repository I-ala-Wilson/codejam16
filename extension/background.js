// Echo Lock, per contracts/extension.md: LOCK / UNLOCK / STATUS from the Echo app tab.
// Blocked sites redirect to blocked.html#<original URL> so the app can send the user back after unlocking.
const RULE_BASE = 1000

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

async function applyRules(sites) {
  const old = await chrome.declarativeNetRequest.getDynamicRules()
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: old.map((r) => r.id),
    addRules: sites.map((s, i) => ({
      id: RULE_BASE + i, priority: 1,
      action: { type: 'redirect', redirect: { regexSubstitution: `chrome-extension://${chrome.runtime.id}/blocked.html#\\0` } },
      condition: { regexFilter: `^https?://([^/]*\\.)?${escapeRe(s)}(/.*)?$`, resourceTypes: ['main_frame'] },
    })),
  })
}

chrome.runtime.onMessageExternal.addListener((msg, _sender, reply) => {
  (async () => {
    const st = await chrome.storage.local.get({ locked: false, sites: [] })
    if (msg.type === 'LOCK') {
      await chrome.storage.local.set({ locked: true, sites: msg.sites, appUrl: msg.appUrl || null })
      await applyRules(msg.sites); reply({ ok: true, locked: true })
    } else if (msg.type === 'UNLOCK') {
      // stays unlocked until the next LOCK (no expiry)
      await chrome.storage.local.set({ locked: false })
      await applyRules([]); reply({ ok: true, locked: false, until: null })
    } else if (msg.type === 'STATUS') {
      reply({ locked: st.locked, sites: st.sites, until: null })
    } else reply({ ok: false, error: 'unknown type' })
  })()
  return true
})
