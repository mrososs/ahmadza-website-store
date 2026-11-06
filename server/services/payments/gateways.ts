import { createError } from 'h3'
import type { PaymentProvider } from './types'

/**
 * Paymob and Tap are intentionally NOT integrated: no gateway credentials were provided or authorised (docs/legacy-audit/10).
 * Both adapters refuse every call with HTTP 501 so a misconfiguration can never silently succeed.
 *
 * Verification design for the real implementation (do NOT fake it):
 *  - Paymob (legacy PAY-06): HMAC-SHA512 over the fixed concatenation of the transaction fields, keyed with the Paymob HMAC
 *    secret, compared in constant time against the `hmac` query value; accept only success && !pending && !voided.
 *  - Tap (legacy PAY-05): never trust the callback — re-fetch the charge from the Tap API with the secret key and require
 *    status CAPTURED and amount/currency/reference equal to the stored payments row.
 *  - Both: verify on the RAW body, register the provider event id (register_payment_event), then call fulfill_payment()
 *    with the amount the provider reports; the DB compares it with payments.amount (PAY-03/05/07, ORD-10/11).
 */
const notIntegrated = (name: string) => () => {
  throw createError({ statusCode: 501, statusMessage: `${name} gateway is not integrated (no authorised credentials)` })
}

const stub = (id: 'paymob' | 'tap', name: string): PaymentProvider => ({
  id,
  assertAvailable: notIntegrated(name),
  mode: (s) => s.payment_mode,
  createSession: async () => notIntegrated(name)(),
  parseWebhook: notIntegrated(name),
})

export const paymob = stub('paymob', 'Paymob')
export const tap = stub('tap', 'Tap')
