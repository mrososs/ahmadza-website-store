export type ProviderId = 'dev_simulator' | 'paymob' | 'tap'
export type DataMode = 'live' | 'test'

export interface PaymentSettings { allow_test_payments: boolean; payment_mode: DataMode; base_currency: string }

/** The slice of runtimeConfig the payment code reads (server-only keys). Kept loose on purpose: Nuxt types env values as strings. */
export type GatewayRuntime = Record<string, unknown>

/** Fetch is injected so the gateway contracts can be tested against a mock without network access. */
export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

export interface ParsedWebhook {
  eventId: string
  reference: string | null     // payments.reference when the callback carries it (never trusted alone)
  providerOrderId: string | null // gateway order / charge id: signed by the gateway (Paymob) or fetched from its API (Tap); the binding key
  status: 'succeeded' | 'failed' | 'pending'
  reversal?: boolean           // refunded / voided after the fact: never fails a fulfilled payment, but the admin must see it
  keyMode: DataMode | null     // which key set validated the event (a test key can never settle a live payment); null for the simulator
  providerTransactionId: string
  amount: number               // what the PROVIDER says it captured: fulfill_payment compares it with the stored payment
  currency: string
  raw: Record<string, unknown> // redacted subset only: no card digits, no billing or customer data
}

export interface SessionRequest {
  payment: { id: string; reference: string; amount: number; currency: string; mode: DataMode }
  items: { name: string; amount: number }[] // priced from the payment's own server-side cart snapshot
  customer: { name: string; email: string; phone: string | null }
  urls: { webhook: string; redirect: string }
}
export interface SessionResult { redirectUrl: string; providerOrderId: string | null }

export interface ProviderStatus {
  id: ProviderId
  label: string
  enabled: boolean
  configured: boolean
  missing: string[]            // environment variable NAMES only, never values
  mode: DataMode
  liveAllowed: boolean
  available: boolean
  reason: string | null
  verified: boolean            // true only after the owner attests an authorised end-to-end sandbox test passed
  currency: { store: string; gateway: string; matches: boolean; confirmed: boolean; note: string }
  region?: string | null       // Paymob only: the regional account (ksa, egypt, uae, oman)
}

export interface PaymentProvider {
  id: ProviderId
  label: string
  /** Admin-facing readiness. Never contains a secret value. */
  status(settings: PaymentSettings, runtime: GatewayRuntime): ProviderStatus
  /** Throws an HTTP error when this provider must not be used right now (disabled, not configured, live not allowed…). */
  assertAvailable(settings: PaymentSettings, runtime: GatewayRuntime): void
  /** data_mode stored on the payment row. */
  mode(settings: PaymentSettings): DataMode
  createSession(req: SessionRequest, runtime: GatewayRuntime): Promise<SessionResult>
  /** Verify the signature over the RAW body (and query) and return the normalised event. Must throw 401 on a bad signature. */
  parseWebhook(rawBody: string, headers: Record<string, string | undefined>, query: Record<string, string | undefined>, runtime: GatewayRuntime): ParsedWebhook
  /** Server-to-server confirmation: returns the AUTHORITATIVE event built from the gateway's own API (never from the callback body). */
  confirm?(hook: ParsedWebhook, runtime: GatewayRuntime): Promise<ParsedWebhook>
  /**
   * The browser came back from the hosted page. Verify what the gateway put in the redirect (signature or API re-fetch) and return an event,
   * or null when nothing can be proven (the result page then simply waits for the webhook). `modes` limits which key sets may be tried.
   */
  verifyReturn?(query: Record<string, string | undefined>, runtime: GatewayRuntime, modes: DataMode[]): Promise<ParsedWebhook | null>
}
