import { createPaymob } from './paymob'
import { createTap } from './tap'

/** The real gateways. Both are NOT VERIFIED against a live sandbox yet: see docs/implementation/PAYMENTS_GO_LIVE_CHECKLIST.md. */
export const paymob = createPaymob()
export const tap = createTap()
