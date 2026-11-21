import { defineConfig } from '@playwright/test'

// APP_DIR: where the app lane lives (a fresh clone with node_modules installed). Defaults to ../app.
const appDir = process.env.APP_DIR ?? '../app'
// QA gets its own port: 5173 is usually someone else's dev server, and testing the wrong checkout invalidates a run.
const port = process.env.QA_PORT ?? '5180'
const baseURL = process.env.BASE_URL ?? `http://localhost:${port}`

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL,
    launchOptions: {
      // Fake mic so getUserMedia succeeds headless. No real audio, so DSP results are not meaningful here.
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
    },
    permissions: ['microphone'],
  },
  // BASE_URL set means test a deployed URL, so do not start a local server.
  webServer: process.env.BASE_URL
    ? undefined
    : { command: `npm run dev -- --port ${port}`, cwd: appDir, url: baseURL, reuseExistingServer: false, timeout: 120_000 },
})
