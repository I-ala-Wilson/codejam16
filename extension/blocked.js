// Link back to the exact Echo page that locked this browser (sent with LOCK as appUrl).
chrome.storage.local.get({ appUrl: null }).then(({ appUrl }) => {
  const a = document.getElementById('open')
  if (appUrl) a.href = appUrl
  else { a.removeAttribute('href'); a.textContent = 'Open the Echo app to unlock' }
})
