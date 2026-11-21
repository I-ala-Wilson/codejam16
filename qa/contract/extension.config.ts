import { defineConfig } from '@playwright/test'

// Extension contract tests load the unpacked MV3 extension, so they need their own context (see extension.spec.ts).
export default defineConfig({
  testDir: '.',
  testMatch: /extension\.spec\.ts/,
  timeout: 60_000,
  workers: 1,
  retries: 0,
  reporter: [['list']],
})
