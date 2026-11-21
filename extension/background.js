// Scaffold per contracts/extension.md: LOCK / UNLOCK / STATUS from the Echo app tab.
const RULE_BASE = 1000

async function applyRules(sites) {
  const old = await chrome.declarativeNetRequest.getDynamicRules()
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: old.map(r => r.id),
    addRules: sites.map((s, i) => ({
      id: RULE_BASE + i, priority: 1,
      action: { type: 'redirect', redirect: { extensionPath: '/blocked.html' } },
      condition: { urlFilter: `||${s}`, resourceTypes: ['main_frame'] },
    })),
  })
}

chrome.runtime.onMessageExternal.addListener((msg, _sender, reply) => {
  (async () => {
    const st = await chrome.storage.local.get({ locked: false, sites: [], until: null })
    if (msg.type === 'LOCK') {
      await chrome.storage.local.set({ locked: true, sites: msg.sites, until: null, appUrl: msg.appUrl || null })
      await applyRules(msg.sites); reply({ ok: true, locked: true })
    } else if (msg.type === 'UNLOCK') {
      const until = Date.now() + 30 * 60 * 1000
      await chrome.storage.local.set({ locked: false, until })
      await applyRules([]); reply({ ok: true, locked: false, until })
    } else if (msg.type === 'STATUS') {
      reply({ locked: st.locked, sites: st.sites, until: st.until })
    } else reply({ ok: false, error: 'unknown type' })
  })()
  return true
})
