/**
 * Legacy rule AUTH-14: guests could self-register as affiliates (users.type = 2) with no review.
 * Kept as the default (owner decision pending, docs/legacy-audit/16). Flip to false to make promotion admin-only.
 */
export const AFFILIATE_SELF_REGISTRATION = true

/** Upload caps for contributor submissions (legacy request-book form: documents/cover 2 MB, book 100 MB). */
export const CONTRIBUTOR_LIMITS = {
  bookBytes: 100 * 1024 * 1024,
  otherBytes: 2 * 1024 * 1024,
  maxRequestsPerHour: 5,
} as const

export const CONTRIBUTOR_DOC_KINDS = ['book', 'cover', 'iban', 'ministry'] as const
export type ContributorDocKind = (typeof CONTRIBUTOR_DOC_KINDS)[number]

/** Short-lived signed URL lifetime for private contributor documents (seconds). */
export const DOCUMENT_URL_TTL = 60
