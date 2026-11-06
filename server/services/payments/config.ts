// Gateway configuration, read from the server-only runtimeConfig (environment variables, never the database, never the browser).
// Nothing here ever returns a secret VALUE to a caller that renders it: status() reports variable NAMES only.
import { createError } from 'h3'
import type { DataMode, GatewayRuntime, PaymentSettings } from './types'

// Nuxt parses environment values, so NUXT_PAYMOB_LIVE_INTEGRATION_IDS=9001 arrives as the NUMBER 9001 (found by the end-to-end gateway test): accept numbers too.
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : '')
const bool = (v: unknown) => v === true || str(v).toLowerCase() === 'true'

export function enabledProviders(runtime: GatewayRuntime): string[] {
  return str(runtime.paymentsEnabledProviders).split(',').map((s) => s.trim()).filter(Boolean)
}
export const liveEnabled = (runtime: GatewayRuntime) => bool(runtime.paymentsLiveEnabled)

/** Env var names for one key (Nuxt maps NUXT_<UPPER_SNAKE of the camelCase key> onto runtimeConfig). */
export const envName = (key: string) => `NUXT_${key.replace(/([A-Z])/g, '_$1').toUpperCase()}`

export interface PaymobKeys { secretKey: string; publicKey: string; hmacSecret: string; integrationIds: number[] }
export function paymobKeys(runtime: GatewayRuntime, mode: DataMode): PaymobKeys | null {
  const p = mode === 'live' ? 'paymobLive' : 'paymobTest'
  const ids = str(runtime[`${p}IntegrationIds`]).split(',').map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0)
  const k = { secretKey: str(runtime[`${p}SecretKey`]), publicKey: str(runtime[`${p}PublicKey`]), hmacSecret: str(runtime[`${p}HmacSecret`]), integrationIds: ids }
  return k.secretKey && k.publicKey && k.hmacSecret && ids.length ? k : null
}
export function paymobMissing(runtime: GatewayRuntime, mode: DataMode): string[] {
  const p = mode === 'live' ? 'paymobLive' : 'paymobTest'
  const missing: string[] = []
  for (const k of ['SecretKey', 'PublicKey', 'HmacSecret']) if (!str(runtime[`${p}${k}`])) missing.push(envName(`${p}${k}`))
  const ids = str(runtime[`${p}IntegrationIds`]).split(',').map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0)
  if (!ids.length) missing.push(envName(`${p}IntegrationIds`))
  return missing
}

export interface TapKeys { secretKey: string }
export function tapKeys(runtime: GatewayRuntime, mode: DataMode): TapKeys | null {
  const k = str(runtime[mode === 'live' ? 'tapLiveSecretKey' : 'tapTestSecretKey'])
  return k ? { secretKey: k } : null
}
export function tapMissing(runtime: GatewayRuntime, mode: DataMode): string[] {
  return tapKeys(runtime, mode) ? [] : [envName(mode === 'live' ? 'tapLiveSecretKey' : 'tapTestSecretKey')]
}

/** Base URLs must be https and are fixed by configuration: they are never taken from a request. */
export function httpsBase(value: unknown, fallback: string): string {
  const v = str(value) || fallback
  let u: URL
  try { u = new URL(v) } catch { throw createError({ statusCode: 500, statusMessage: 'Payment gateway URL is not valid' }) }
  if (u.protocol !== 'https:' && !(u.hostname === 'localhost' || u.hostname === '127.0.0.1')) throw createError({ statusCode: 500, statusMessage: 'Payment gateway URL must use https' })
  return v.replace(/\/+$/, '')
}

/** Public origin the gateway calls back to. A gateway cannot reach localhost, so a real deployment must set it. */
export function callbackOrigin(runtime: GatewayRuntime, publicSiteUrl: unknown): string {
  return httpsBase(runtime.paymentsPublicBaseUrl || publicSiteUrl, 'http://127.0.0.1:3000')
}

/** Paymob accounts are regional (the docs: no global account). Base and Unified Checkout hosts per region, from the Paymob documentation. */
export const PAYMOB_REGIONS = {
  ksa: { base: 'https://ksa.paymob.com', checkout: 'https://ksa.checkout.paymob.com' },
  egypt: { base: 'https://accept.paymob.com', checkout: 'https://eg.checkout.paymob.com' },
  uae: { base: 'https://uae.paymob.com', checkout: 'https://uae.checkout.paymob.com' },
  oman: { base: 'https://oman.paymob.com', checkout: 'https://om.checkout.paymob.com' },
} as const
export type PaymobRegion = keyof typeof PAYMOB_REGIONS
/** The region of the owner's Paymob account (the legacy store was KSA, so that is the default). null = an unknown value, which makes the provider unavailable. */
export function paymobRegion(runtime: GatewayRuntime): PaymobRegion | null {
  const r = str(runtime.paymobRegion).toLowerCase() || 'ksa'
  return r in PAYMOB_REGIONS ? (r as PaymobRegion) : null
}

export interface CurrencyAssurance { store: string; gateway: string; matches: boolean; confirmed: boolean; note: string }

const NOTES = {
  Paymob: 'Paymob requires the request currency to equal the currency of the integration id, and its public documentation does not list which currencies a regional account can charge (including whether a KSA account can charge USD). Read the currency shown for your integration in the Paymob dashboard (Developers, Payment Integrations) and confirm it with Paymob.',
  Tap: 'The public Tap documentation does not list its supported currencies or say whether a Saudi merchant account can charge USD. Confirm the currency your merchant account can charge with Tap.',
} as const

/**
 * The owner must CONFIRM, in configuration, the currency the provider account really charges in. Nothing is assumed from the store currency and nothing is converted:
 * until the confirmation equals the store currency the provider stays unavailable.
 */
export function currencyAssurance(provider: keyof typeof NOTES, configured: unknown, settings: PaymentSettings): CurrencyAssurance {
  const store = settings.base_currency.toUpperCase()
  const gateway = str(configured).toUpperCase()
  return { store, gateway: gateway || 'not confirmed', matches: gateway !== '' && gateway === store, confirmed: gateway !== '', note: NOTES[provider] }
}

/** Shared availability rules for the real gateways. Returns the reason it is NOT available, or null. */
export function unavailableReason(args: {
  id: string; runtime: GatewayRuntime; settings: PaymentSettings; configured: boolean; verified: boolean; currency: CurrencyAssurance; currencyVar: string
}): string | null {
  const { id, runtime, settings, configured, verified, currency, currencyVar } = args
  if (!enabledProviders(runtime).includes(id)) return 'provider is not in NUXT_PAYMENTS_ENABLED_PROVIDERS'
  if (!configured) return `credentials for ${settings.payment_mode} mode are not configured`
  if (!currency.confirmed) return `the account currency is not confirmed: set ${currencyVar} to the currency your ${id} account really charges in (it must equal the store currency ${currency.store}; no conversion is ever applied)`
  if (!currency.matches) return `the confirmed account currency ${currency.gateway} differs from the store currency ${currency.store} (no conversion is ever applied)`
  if (settings.payment_mode === 'test' && !settings.allow_test_payments) return 'test payments are disabled in site settings (allow_test_payments)'
  if (settings.payment_mode === 'live') {
    if (!liveEnabled(runtime)) return 'live payments are disabled (NUXT_PAYMENTS_LIVE_ENABLED is not true)'
    if (!verified) return 'the gateway is NOT VERIFIED: live is refused until the owner attests an authorised end-to-end test'
  }
  return null
}

export function refuse(reason: string): never {
  throw createError({ statusCode: 503, statusMessage: `Payment method unavailable: ${reason}` })
}
