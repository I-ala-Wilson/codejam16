# CONTRACT: app tab <-> Chrome extension (Lock)

The extension (extension/) blocks sites; the web app (app/) senses gestures and tells it to unlock. The extension never touches the mic (plan B is the default).

- `manifest.json` has `"externally_connectable": {"matches": ["http://localhost:*/*", "https://*.vercel.app/*"]}`.
- The app knows the extension id from `VITE_EXTENSION_ID` (.env) and sends:

| message (app -> extension) | effect | reply |
|---|---|---|
| `{type:'LOCK', sites:['youtube.com','tiktok.com']}` | kid mode on: those sites redirect to the extension's `blocked.html` | `{ok:true, locked:true}` |
| `{type:'UNLOCK'}` | kid mode off for 30 min | `{ok:true, locked:false, until:<ms epoch>}` |
| `{type:'STATUS'}` | - | `{locked:boolean, sites:string[], until:number|null}` |

- `blocked.html` shows "Locked by Echo. Ask a parent." and a button that opens the app's `/lock` page.
- The secret sequence and attempt counting live in the app, never in the extension.
