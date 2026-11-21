import fs from 'node:fs'
import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

// The engine tells onnxruntime-web to load its runtime from /ort/. In dev, Vite refuses to let source code
// import files from public/ ("cannot be imported from source"), so serve /ort/* raw, before Vite's own handling.
const ORT_DIR = path.resolve(__dirname, '../engine/node_modules/onnxruntime-web/dist')
function serveOrt(): Plugin {
  return {
    name: 'serve-ort',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0]
        if (!url.startsWith('/ort/')) return next()
        const file = path.join(ORT_DIR, path.basename(url))
        if (!fs.existsSync(file)) return next()
        res.setHeader('Content-Type', file.endsWith('.wasm') ? 'application/wasm' : 'text/javascript')
        fs.createReadStream(file).pipe(res)
      })
    },
  }
}

export default defineConfig({
  plugins: [serveOrt(), react()],
  envDir: '..',
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      '@engine': path.resolve(__dirname, '../engine/src'),
      '@ui': path.resolve(__dirname, '../ui/src'),
      '@contracts': path.resolve(__dirname, '../contracts'),
    },
  },
  server: { port: 5173, strictPort: true, fs: { allow: ['..'] } },
})
