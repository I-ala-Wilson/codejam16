// App side of contracts/extension.md. The extension id comes from .env (VITE_EXTENSION_ID) or the Lock page.
declare const chrome: { runtime?: { sendMessage: (id: string, msg: unknown, cb: (reply: unknown) => void) => void; lastError?: { message: string } } }

export type ExtReply = { ok?: boolean; locked?: boolean; sites?: string[]; until?: number | null; error?: string }

// extension/manifest.json carries a fixed public key, so every unpacked install of Echo Lock gets this same id.
export const DEFAULT_EXTENSION_ID = 'kgakdpenopmnppeeenmllkoocdiadgne'

export function extensionId(): string {
  return localStorage.getItem('echo.extId') || (import.meta.env.VITE_EXTENSION_ID as string | undefined) || DEFAULT_EXTENSION_ID
}

export function sendToExtension(msg: { type: 'LOCK'; sites: string[]; appUrl?: string } | { type: 'UNLOCK' } | { type: 'STATUS' } | { type: 'PROGRESS'; n: number } | { type: 'CALIB'; n: number }): Promise<ExtReply> {
  return new Promise((resolve, reject) => {
    const id = extensionId()
    if (!id) return reject(new Error('No extension id set'))
    if (!chrome?.runtime?.sendMessage) return reject(new Error('Not in Chrome, or the extension is not installed/allowed for this site'))
    chrome.runtime.sendMessage(id, msg, (reply) => {
      const err = chrome.runtime?.lastError
      if (!err) return resolve(reply as ExtReply)
      // a saved id from an older install: fall back to the fixed id and remember it if that answers
      if (id === DEFAULT_EXTENSION_ID) return reject(new Error(err.message))
      chrome.runtime!.sendMessage(DEFAULT_EXTENSION_ID, msg, (reply2) => {
        const err2 = chrome.runtime?.lastError
        if (err2) reject(new Error(err.message)); else { localStorage.setItem('echo.extId', DEFAULT_EXTENSION_ID); resolve(reply2 as ExtReply) }
      })
    })
  })
}
