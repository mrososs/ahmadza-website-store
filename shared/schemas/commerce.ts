import { z } from 'zod'
import { MAX_CART_ITEMS } from '../constants'

// Browser input is book ids ONLY. Unknown keys (e.g. a forged "price"/"total") are stripped by zod and never read.
export const quoteSchema = z.object({ bookIds: z.array(z.number().int().positive()).max(MAX_CART_ITEMS) })
export const checkoutSessionSchema = z.object({
  bookIds: z.array(z.number().int().positive()).min(1).max(MAX_CART_ITEMS),
  provider: z.enum(['paymob', 'tap', 'dev_simulator']).optional(), // which enabled method the customer picked; the server re-checks it
})
export const simulateSchema = z.object({ outcome: z.enum(['success', 'failure']) })

/** Payload of the local dev-simulator webhook (signed with HMAC-SHA256 in the x-aawraq-signature header). */
export const devWebhookSchema = z.object({
  event_id: z.string().min(1).max(120),
  reference: z.string().uuid(),
  status: z.enum(['succeeded', 'failed']),
  transaction_id: z.string().min(1).max(120),
  amount: z.number().positive(),
  currency: z.string().length(3),
})

export interface QuoteItem { id: number; title: string; slug: string; cover_path: string | null; unit_price: number; currency: string }
export interface QuoteResponse { items: QuoteItem[]; total: number; currency: string; unavailable: number[]; owned: number[] }
