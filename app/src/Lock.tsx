import { useEffect, useState } from 'react'
import { Window } from '@ui/index.ts'
import { extensionId, sendToExtension, type ExtReply } from './extension.ts'

const DEFAULT_SITES = ['youtube.com', 'tiktok.com', 'roblox.com']

// #7 part 1: wiring to the extension. The gesture-password flow (#12) builds on this page.
export default function Lock() {
  const [extId, setExtId] = useState(extensionId())
  const [sites, setSites] = useState(DEFAULT_SITES.join(', '))
  const [state, setState] = useState<ExtReply | null>(null)
  const [error, setError] = useState('')

  const call = async (msg: Parameters<typeof sendToExtension>[0]) => {
    setError('')
    try { setState(await sendToExtension(msg)) } catch (e) { setError(String(e)) }
  }
  useEffect(() => { if (extId) call({ type: 'STATUS' }) }, [])

  return (
    <Window title="Lock (kid mode)">
      <h3>1. Install the extension (once)</h3>
      <ol>
        <li>Open <code>chrome://extensions</code>, turn on <b>Developer mode</b> (top right).</li>
        <li><b>Load unpacked</b> and pick the <code>codejam16/extension</code> folder.</li>
        <li>Copy the extension's <b>ID</b> and paste it here:{' '}
          <input value={extId} onChange={(e) => { setExtId(e.target.value.trim()); localStorage.setItem('echo.extId', e.target.value.trim()) }} style={{ width: 280 }} placeholder="e.g. abcdefghijklmnopabcdefghijklmnop" />
        </li>
      </ol>
      <h3>2. Test lock and unlock</h3>
      <p>Sites to block: <input value={sites} onChange={(e) => setSites(e.target.value)} style={{ width: 360 }} /></p>
      <p>
        <button onClick={() => call({ type: 'LOCK', sites: sites.split(',').map((s) => s.trim()).filter(Boolean) })}>Lock</button>{' '}
        <button onClick={() => call({ type: 'UNLOCK' })}>Unlock</button>{' '}
        <button onClick={() => call({ type: 'STATUS' })}>Status</button>
      </p>
      {state && <p><b>{state.locked ? 'LOCKED' : 'Unlocked'}</b>{state.sites?.length ? ` · ${state.sites.join(', ')}` : ''}{state.until ? ` · unlocked until ${new Date(state.until).toLocaleTimeString()}` : ''}</p>}
      {error && <p><b>Problem:</b> {error}</p>}
      <p>Then open youtube.com in a new tab: locked shows "Locked by Echo", unlocked plays normally.</p>
      <p><i>Next (#12): unlock only with the secret 4-gesture rhythm; 3 wrong tries sound an alarm and alert the parent dashboard.</i></p>
    </Window>
  )
}
