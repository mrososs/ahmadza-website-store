import { z } from 'zod'
import { adminSettingsSchema } from './index'

export const ADMIN_PAGE_SIZE = 20
export const ADMIN_ENTITIES = ['categories', 'makers', 'articles', 'pages'] as const
export type AdminEntity = (typeof ADMIN_ENTITIES)[number]

export const adminListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  q: z.string().trim().max(120).optional().default(''),
  status: z.string().trim().max(20).optional().default('all'),
})

export const adminRelatedSchema = z.object({ related_ids: z.array(z.number().int().positive()).max(60).default([]) })

export const adminMediaUpdateSchema = z.object({
  name: z.string().trim().max(200).optional(),
  visibility: z.enum(['preview', 'after_purchase']).optional(),
  sort_order: z.number().int().min(0).max(100000).optional(),
})

export const adminExternalMediaSchema = z.object({
  external_url: z.string().url().max(1000).refine((u) => u.startsWith('https://'), 'الروابط الخارجية يجب أن تبدأ بـ https://'),
  name: z.string().trim().min(1).max(200),
  kind: z.enum(['file', 'audio']).default('file'),
  visibility: z.enum(['preview', 'after_purchase']).default('after_purchase'),
  sort_order: z.number().int().min(0).max(100000).default(0),
})

export const adminSettingsFullSchema = adminSettingsSchema.extend({
  show_poster_desktop: z.boolean(),
  show_poster_mobile: z.boolean(),
  payment_mode: z.enum(['live', 'test']),
  require_admin_mfa: z.boolean(),
})

export const adminUserStatusSchema = z.object({ status: z.enum(['active', 'review', 'banned']) })
export const adminContactUpdateSchema = z.object({ is_handled: z.boolean() })
export const adminCommentUpdateSchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected']).optional(),
  visible_to_public: z.boolean().optional(),
})
export const adminDemoPurgeSchema = z.object({ confirm: z.literal('DELETE-DEMO') })
export const adminReportQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  mode: z.enum(['live', 'test', 'all']).default('live'),
  format: z.enum(['json', 'csv']).default('json'),
})

export const adminBooksListQuerySchema = adminListQuerySchema.extend({
  recovery: z.enum(['all', 'recovered', 'not_ready', 'ready', 'missing_media']).default('all'),
  workflow: z.enum(['all', 'draft', 'needs_review', 'missing_media', 'ready', 'published', 'archived']).default('all'),
  // cover: none = no cover, generated = generated from the book's PDF, original = a recovered original, candidate = a proposed cover waits for a decision.
  cover: z.enum(['all', 'none', 'generated', 'original', 'candidate']).default('all'),
  // gap: what is still missing: price (0 on a paid book), author (no author assigned), pdf (no verified file in storage).
  gap: z.enum(['all', 'price', 'author', 'pdf']).default('all'),
})

export const recoveryRunSchema = z.object({ run: z.coerce.number().int().positive() })
export const recoveryVerifySchema = recoveryRunSchema.extend({ confirm: z.string().trim().max(120) })
export const recoveryPromoteSchema = z.object({ run: z.coerce.number().int().positive().optional() })

/** An administrator's decision on one cover candidate (its id is the first 12 hex characters of the image's SHA-256). */
export const adminCoverDecisionSchema = z.object({
  candidate: z.string({ error: 'المرشح مطلوب' }).regex(/^[0-9a-f]{12}$/, 'معرّف المرشح غير صالح'),
  decision: z.enum(['approve', 'reject'], { error: 'القرار غير صالح' }),
})

// ---- bulk book administration (free / paid / soft delete) ----
export const BULK_BOOKS_MAX = 100
export const BULK_BOOK_OPERATIONS = ['make_free', 'make_paid', 'soft_delete'] as const
export type BulkBookOperation = (typeof BULK_BOOK_OPERATIONS)[number]

const bulkIds = z.array(z.number({ error: 'معرّف كتاب غير صالح' }).int('معرّف كتاب غير صالح').positive('معرّف كتاب غير صالح'), { error: 'قائمة الكتب غير صالحة' })
  .min(1, 'اختر كتاباً واحداً على الأقل')
  .max(BULK_BOOKS_MAX, `الحد الأقصى ${BULK_BOOKS_MAX} كتاباً في العملية الواحدة`)
  .refine((ids) => new Set(ids).size === ids.length, 'قائمة الكتب تحتوي معرّفات مكررة')

/** Same ceiling as a single book (adminBookSchema); at most two decimals (numeric(12,2) in the database). */
export const bulkPriceSchema = z.number({ error: 'السعر غير صالح' })
  .positive('السعر يجب أن يكون أكبر من صفر')
  .max(100000, 'السعر كبير جداً')
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, 'السعر يقبل خانتين عشريتين على الأكثر')

export const adminBulkBooksSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('make_free'), ids: bulkIds }),
  z.object({ operation: z.literal('make_paid'), ids: bulkIds, price: bulkPriceSchema }),
  z.object({ operation: z.literal('soft_delete'), ids: bulkIds }),
], { error: 'نوع العملية غير صالح' })
export type AdminBulkBooksInput = z.infer<typeof adminBulkBooksSchema>

export type BulkSkipReason = 'not_found' | 'already_deleted' | 'unchanged' | 'not_eligible' | 'invalid_price' | 'public_full_pdf'
export interface BulkBooksResult { operation: BulkBookOperation; requested: number; updated: number[]; skipped: Array<{ id: number; reason: BulkSkipReason }> }
export const BULK_SKIP_LABEL: Record<BulkSkipReason, string> = {
  not_found: 'الكتاب غير موجود',
  already_deleted: 'الكتاب في المهملات',
  unchanged: 'لا تغيير: الكتاب بالحالة المطلوبة مسبقاً',
  not_eligible: 'كتاب مُسترجع غير مكتمل: لا يُغيَّر وهو منشور',
  invalid_price: 'السعر غير مقبول لهذا الكتاب',
  public_full_pdf: 'ملف عام مطابق للكتاب الكامل: احذفه أولاً',
}
