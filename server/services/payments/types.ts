export type ProviderId = 'dev_simulator' | 'paymob' | 'tap'

export interface PaymentSettings { allow_test_payments: boolean; payment_mode: 'live' | 'test'; base_currency: string }

export interface ParsedWebhook {
  eventId: string
  reference: string          // payments.reference
  status: 'succeeded' | 'failed'
  providerTransactionId: string
  amount: number             // amount the PROVIDER says it captured — fulfill_payment compares it with the stored payment
  currency: string
  raw: Record<string, unknown>
}

export interface PaymentProvider {
  id: ProviderId
  /** Throws an HTTP error when this provider must not be used right now (production, disabled, not integrated…). */
  assertAvailable(settings: PaymentSettings, runtime: { allowDevPaymentSimulator?: unknown }): void
  /** data_mode stored on the payment row. */
  mode(settings: PaymentSettings): 'live' | 'test'
  createSession(payment: { id: string; reference: string }): Promise<{ redirectUrl: string }>
  /** Verify the signature over the RAW body and return the normalised event. Must throw 401 on a bad signature. */
  parseWebhook(rawBody: string, headers: Record<string, string | undefined>): ParsedWebhook
}
