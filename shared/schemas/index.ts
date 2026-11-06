import { z } from 'zod'
import { MAX_CART_ITEMS } from '../constants'

const email = z.string().trim().toLowerCase().email('البريد الإلكتروني غير صالح').max(254)
const password = z.string().min(8, 'كلمة المرور 8 أحرف على الأقل').max(128)

export const loginSchema = z.object({ email, password: z.string().min(1, 'كلمة المرور مطلوبة').max(128) })
export const registerSchema = z.object({
  displayName: z.string().trim().min(2, 'الاسم مطلوب').max(120),
  email,
  password,
  passwordConfirm: z.string(),
}).refine((v) => v.password === v.passwordConfirm, { path: ['passwordConfirm'], message: 'كلمتا المرور غير متطابقتين' })
export const forgotPasswordSchema = z.object({ email })
export const resetPasswordSchema = z.object({
  password, passwordConfirm: z.string(),
}).refine((v) => v.password === v.passwordConfirm, { path: ['passwordConfirm'], message: 'كلمتا المرور غير متطابقتين' })

export const profileUpdateSchema = z.object({
  display_name: z.string().trim().min(2).max(120),
  phone: z.string().trim().max(32).optional().nullable(),
  country: z.string().trim().max(80).optional().nullable(),
})

export const contactSchema = z.object({
  name: z.string().trim().min(2, 'الاسم مطلوب').max(120),
  email,
  subject: z.enum(['note', 'request', 'report', 'other']),
  message: z.string().trim().min(5, 'الرسالة قصيرة جداً').max(5000),
})

export const idSchema = z.coerce.number().int().positive()

/** The browser sends book ids ONLY. Prices are always read from the database. */
export const checkoutSchema = z.object({
  bookIds: z.array(z.number().int().positive()).min(1).max(MAX_CART_ITEMS),
  affiliateRef: z.string().uuid().optional().nullable(),
})

export const commentSchema = z.object({ bookId: z.number().int().positive(), body: z.string().trim().min(1).max(4000) })

export const withdrawalSchema = z.object({ amount: z.number().positive().max(1_000_000) })
export const payoutMethodSchema = z.object({
  kind: z.enum(['paypal', 'bank_transfer']),
  details: z.record(z.string(), z.string().max(300)).refine((d) => Object.keys(d).length > 0 && Object.keys(d).length <= 8, 'بيانات غير صالحة'),
})

export const contributorRequestSchema = z.object({
  title: z.string().trim().min(2).max(200),
  makerName: z.string().trim().max(200).optional().nullable(),
  about: z.string().trim().max(5000).optional().nullable(),
  deal: z.enum(['share', 'rent']),
  cost: z.number().min(0).max(100000).optional().nullable(),
  whatsapp: z.string().trim().max(32).optional().nullable(),
  iban: z.string().trim().max(64).optional().nullable(),
})

// ---- admin ---------------------------------------------------------------
const status = z.enum(['draft', 'published', 'coming_soon', 'archived'])
export const adminBookSchema = z.object({
  title: z.string().trim().min(1).max(250),
  description_html: z.string().max(100_000).optional().nullable(),
  kind: z.enum(['paid', 'free']),
  status,
  price_amount: z.number().min(0).max(100000),
  pages: z.number().int().min(0).max(100000).default(0),
  category_ids: z.array(z.number().int().positive()).default([]),
  maker_ids: z.array(z.object({ id: z.number().int().positive(), role: z.enum(['author', 'reader', 'writer']) })).default([]),
  tags: z.array(z.string().trim().min(1).max(60)).max(30).default([]),
}).refine((b) => (b.kind === 'free' ? b.price_amount === 0 : b.price_amount > 0 || b.status === 'draft'), {
  path: ['price_amount'], message: 'الكتاب المدفوع يحتاج سعراً أكبر من صفر، والمجاني سعره صفر',
})
export const adminCategorySchema = z.object({ name: z.string().trim().min(1).max(120), is_active: z.boolean().default(true) })
export const adminMakerSchema = z.object({
  name: z.string().trim().min(1).max(160),
  kind: z.enum(['author', 'reader', 'writer']),
  era: z.enum(['old', 'new']),
  bio_html: z.string().max(50_000).optional().nullable(),
  is_active: z.boolean().default(true),
})
export const adminArticleSchema = z.object({
  kind: z.enum(['article', 'video', 'ads']).default('article'),
  title: z.string().trim().min(1).max(250),
  excerpt: z.string().max(1000).optional().nullable(),
  content_html: z.string().max(200_000).optional().nullable(),
  status: z.enum(['draft', 'published', 'archived']),
})
export const adminPageSchema = z.object({
  slug: z.string().trim().regex(/^[^\s/]+$/, 'الرابط لا يحتوي مسافات أو /').max(120),
  title: z.string().trim().min(1).max(250),
  content_html: z.string().max(200_000).optional().nullable(),
  positions: z.array(z.enum(['header', 'footer'])).default([]),
  status: z.enum(['draft', 'published', 'archived']),
})
export const adminSettingsSchema = z.object({
  site_name: z.string().trim().min(1).max(120),
  phone: z.string().max(40).optional().nullable(),
  email: z.string().email().optional().nullable().or(z.literal('')),
  description: z.string().max(500).optional().nullable(),
  keywords: z.string().max(500).optional().nullable(),
  facebook: z.string().max(300).optional().nullable(), twitter: z.string().max(300).optional().nullable(),
  instagram: z.string().max(300).optional().nullable(), youtube: z.string().max(300).optional().nullable(),
  telegram: z.string().max(300).optional().nullable(), linkedin: z.string().max(300).optional().nullable(),
  whatsapp: z.string().max(300).optional().nullable(),
  show_free_book_button: z.boolean(),
  affiliate_commission_percent: z.number().min(0).max(100),
  commission_freeze_days: z.number().int().min(0).max(365),
  min_withdrawal_amount: z.number().min(0).max(1_000_000),
})
export const decisionSchema = z.object({ approve: z.boolean(), note: z.string().max(1000).optional().nullable() })

export type CheckoutInput = z.infer<typeof checkoutSchema>
export type AdminBookInput = z.infer<typeof adminBookSchema>
