import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))

// Hosted-project suite only (tests/hosted). Never part of `npm test`; see tests/hosted/helpers.ts for the safety rails.
export default defineConfig({
  resolve: { alias: { '~~': root, '@@': root } },
  test: { environment: 'node', include: ['tests/hosted/**/*.test.ts'], fileParallelism: false, testTimeout: 60_000, hookTimeout: 120_000 },
})
