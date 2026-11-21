// App side of contracts/extension.md. The extension id comes from .env (VITE_EXTENSION_ID) or the Lock page.
declare const chrome: { runtime?: { sendMessage: (id: string, msg: unknown, cb: (reply: unknown) => void) => void; lastError?: { message: string } } }

export type ExtReply = { ok?: boolean; locked?: boolean; sites?: string[]; until?: number | null; error?: string }

export function extensionId(): string {
  return localStorage.getItem('echo.extId') || (import.meta.env.VITE_EXTENSION_ID as string | undefined) || ''
}

export function sendToExtension(msg: { type: 'LOCK'; sites: string[]; appUrl?: string } | { type: 'UNLOCK' } | { type: 'STATUS' }): Promise<ExtReply> {
  return new Promise((resolve, reject) => {
    const id = extensionId()
    if (!id) return reject(new Error('No extension id set'))
    if (!chrome?.runtime?.sendMessage) return reject(new Error('Not in Chrome, or the extension is not installed/allowed for this site'))
    chrome.runtime.sendMessage(id, msg, (reply) => {
      const err = chrome.runtime?.lastError
      if (err) reject(new Error(err.message)); else resolve(reply as ExtReply)
    })
  })
}
