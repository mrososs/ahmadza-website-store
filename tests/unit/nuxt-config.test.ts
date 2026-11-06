// Cheap guard for the hydration fix: payloads must stay inline (see the comment in nuxt.config.ts and tests/e2e/hydration.spec.ts).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const config = readFileSync(new URL('../../nuxt.config.ts', import.meta.url), 'utf8')

describe('nuxt.config.ts', () => {
  it('keeps page payloads inline (payloadExtraction: false) so HTML and hydration data cannot drift apart', () => {
    expect(config).toMatch(/experimental:\s*\{[^}]*payloadExtraction:\s*false/)
  })
  it('keeps the dev payment simulator out of production by default', () => {
    expect(config).toMatch(/allowDevPaymentSimulator:\s*process\.env\.NODE_ENV !== 'production'/)
  })
  it('does not enable the Supabase-Storage or VPS media providers by default in production', () => {
    expect(config).toMatch(/mediaEnabledProviders:\s*process\.env\.NODE_ENV === 'production' \? 'external'/)
  })
})
