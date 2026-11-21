# CONTRACT: app tab <-> Chrome extension (Lock)

The extension (extension/) blocks sites; the web app (app/) senses gestures and tells it to unlock. The extension never touches the mic (plan B is the default).

- `manifest.json` has `"externally_connectable": {"matches": ["http://localhost:*/*", "https://*.vercel.app/*"]}`.
- The app knows the extension id from `VITE_EXTENSION_ID` (.env) and sends:

| message (app -> extension) | effect | reply |
|---|---|---|
| `{type:'LOCK', sites:['youtube.com','tiktok.com'], appUrl?:'http://localhost:5173/#lock'}` | kid mode on: those sites redirect to the extension's `blocked.html`, whose button opens `appUrl` | `{ok:true, locked:true}` |
| `{type:'UNLOCK'}` | kid mode off until the next LOCK (no expiry) | `{ok:true, locked:false, until:null}` |
| `{type:'STATUS'}` | - | `{locked:boolean, sites:string[], until:number|null}` |

- Blocked sites redirect to `blocked.html#<original URL>`. It shows "Locked by Echo" and a link to `appUrl?unlock=1&return=<original URL>`, so the app opens in unlock mode and sends the user back after a correct password.
- The secret sequence and attempt counting live in the app, never in the extension.
