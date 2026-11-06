import { defineConfig } from '@playwright/test'

// UI validation + e2e against the LOCAL dev/preview server. Uses the installed Chrome (no browser download).
export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts/,
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  outputDir: '../../test-results',
  use: {
    baseURL: process.env.TEST_APP_URL ?? 'http://localhost:3000',
    channel: 'chrome',
    locale: 'ar',
    ignoreHTTPSErrors: true,
  },
})
