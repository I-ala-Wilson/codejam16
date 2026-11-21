// Link back to the Echo page that locked this browser, in unlock mode, carrying the blocked URL so the app returns here.
const returnUrl = decodeURIComponent(location.hash.slice(1))
chrome.storage.local.get({ appUrl: null }).then(({ appUrl }) => {
  const a = document.getElementById('open')
  if (!appUrl) { a.removeAttribute('href'); a.textContent = 'Open the Echo app to unlock'; return }
  const u = new URL(appUrl)
  u.searchParams.set('unlock', '1')
  if (returnUrl) u.searchParams.set('return', returnUrl)
  a.href = u.toString()
  const site = document.getElementById('site')
  if (site && returnUrl) site.textContent = new URL(returnUrl).hostname.replace(/^www\./, '')
})
