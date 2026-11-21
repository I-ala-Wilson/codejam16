import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
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
