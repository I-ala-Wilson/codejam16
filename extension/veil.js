// Injected at document_start on locked sites: stop the real page and show what looks like the browser's own
// "can't be reached" error. The only tell is a few tiny dots at the bottom while the right hand signs come in.
(() => {
  const host = location.hostname
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${host}</title><style>
  :root { color-scheme: light dark; --bg: #fff; --fg: #202124; --muted: #5f6368; --btn: #1a73e8; --btnfg: #fff; }
  @media (prefers-color-scheme: dark) { :root { --bg: #202124; --fg: #e8eaed; --muted: #9aa0a6; --btn: #8ab4f8; --btnfg: #202124; } }
  html, body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.55 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  .w { max-width: 600px; margin: 14vh auto 0; padding: 0 24px; }
  .icon { width: 72px; height: 72px; margin-bottom: 40px; }
  h1 { font-size: 1.6em; font-weight: 400; margin: 0 0 15px; }
  p { color: var(--muted); margin: 0 0 15px; }
  ul { color: var(--muted); margin: 0 0 15px; padding-left: 22px; }
  .code { color: var(--muted); font-size: .86em; text-transform: uppercase; margin-top: 24px; }
  .row { display: flex; justify-content: space-between; align-items: center; margin-top: 48px; }
  .det { color: var(--btn); background: none; border: 0; font: inherit; cursor: pointer; padding: 0; }
  .rel { background: var(--btn); color: var(--btnfg); border: 0; border-radius: 18px; font: 500 14px system-ui, sans-serif; padding: 9px 24px; cursor: pointer; }
  #dots { position: fixed; left: 50%; bottom: 14px; transform: translateX(-50%); display: flex; gap: 5px; }
  #dots i { width: 3px; height: 3px; border-radius: 50%; background: var(--muted); opacity: .7; }
  </style></head><body><div class="w">
  <svg class="icon" viewBox="0 0 72 72" fill="none" stroke="currentColor" stroke-width="3" opacity=".55"><path d="M18 8h26l12 12v44H18z"/><path d="M44 8v12h12"/><circle cx="29" cy="38" r="2.4" fill="currentColor"/><circle cx="45" cy="38" r="2.4" fill="currentColor"/><path d="M28 52c5-5 13-5 18 0"/></svg>
  <h1>This site can’t be reached</h1>
  <p><b>${host}</b> refused to connect.</p>
  <p>Try:</p><ul><li>Checking the connection</li><li>Checking the proxy and the firewall</li></ul>
  <div class="code">ERR_CONNECTION_REFUSED</div>
  <div class="row"><button class="det">Details</button><button class="rel" id="rel">Reload</button></div>
  </div><div id="dots"></div></body></html>`
  const paint = () => {
    // replace the whole document with the fake error page (document.write at document_start can leave no body)
    const doc = new DOMParser().parseFromString(html, 'text/html')
    document.replaceChild(document.importNode(doc.documentElement, true), document.documentElement)
    document.title = host
    document.getElementById('rel').onclick = () => location.reload()
  }
  paint()
  chrome.runtime.sendMessage({ type: 'VEIL_UP' }).catch(() => {})
  const dots = (n) => { const d = document.getElementById('dots'); if (d) d.innerHTML = '<i></i>'.repeat(n) }
  chrome.storage.local.get({ progress: 0, progressAt: 0 }).then(({ progress, progressAt }) => dots(Date.now() - progressAt < 8000 ? progress : 0))
  chrome.storage.onChanged.addListener((ch) => {
    if (ch.locked && ch.locked.newValue === false) location.reload()
    if (ch.progress) dots(ch.progress.newValue)
  })
})()
