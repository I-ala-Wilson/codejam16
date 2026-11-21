# CONTRACT: app tab <-> Chrome extension (Lock)

The extension (extension/) blocks sites; the web app (app/) senses gestures and tells it to unlock. The extension never touches the mic (plan B is the default).

- `manifest.json` has `"externally_connectable": {"matches": ["http://localhost:*/*", "https://*.vercel.app/*"]}`.
- The app knows the extension id from `VITE_EXTENSION_ID` (.env) and sends:

| message (app -> extension) | effect | reply |
|---|---|---|
| `{type:'LOCK', sites:['youtube.com','tiktok.com']}` | secret lock on: those sites keep their URL but `veil.js` (registered content script, document_start) replaces them with a fake "This site can't be reached" page; open tabs on them reload | `{ok:true, locked:true}` |
| `{type:'UNLOCK'}` | lock off until the next LOCK (no expiry); veiled tabs reload to the real site | `{ok:true, locked:false, until:null}` |
| `{type:'PROGRESS', n:0..4}` | veiled pages show n tiny dots at the bottom (each right sign in order) | `{ok:true}` |
| `{type:'STATUS'}` | - | `{locked:boolean, sites:string[], until:number|null}` |

- Secret mode (Ian, Sat 10:00): nothing says "locked". The app tab runs the sonar; `app/src/lock/guardian.ts` listens on every page, keeps only a correct prefix of the password, sends PROGRESS, and on the full password toggles LOCK/UNLOCK. No sound, no visible unlock screen.
- The secret sequence lives in the app, never in the extension.
