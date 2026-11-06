import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  resolve: { alias: { '~~': root, '@@': root } },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/db/**/*.test.ts', 'tests/api/**/*.test.ts'],
    // DB / API tests talk to the LOCAL Supabase stack and share state: run files one at a time.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
})
