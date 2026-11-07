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
// Every message here is shown to the operator as-is (form errors AND the 400 body), so they are Arabic sentences, not schema jargon.
const status = z.enum(['draft', 'published', 'coming_soon', 'archived'], { error: 'الحالة غير صالحة' })
const entityStatus = z.enum(['draft', 'published', 'archived'], { error: 'الحالة غير صالحة' })
const adminName = (label: string, max: number) => z.string({ error: `${label} مطلوب` }).trim().min(1, `${label} مطلوب`).max(max, `${label} لا يزيد عن ${max} حرفاً`)
export const adminBookSchema = z.object({
  title: adminName('عنوان الكتاب', 250),
  description_html: z.string({ error: 'الوصف غير صالح' }).max(100_000, 'الوصف طويل جداً').optional().nullable(),
  kind: z.enum(['paid', 'free'], { error: 'نوع الكتاب غير صالح' }),
  status,
  price_amount: z.number({ error: 'السعر غير صالح' }).min(0, 'السعر لا يمكن أن يكون سالباً').max(100000, 'السعر كبير جداً'),
  pages: z.number({ error: 'عدد الصفحات غير صالح' }).int('عدد الصفحات يجب أن يكون رقماً صحيحاً').min(0, 'عدد الصفحات لا يمكن أن يكون سالباً').max(100000, 'عدد الصفحات كبير جداً').default(0),
  category_ids: z.array(z.number().int().positive(), { error: 'الأقسام غير صالحة' }).default([]),
  maker_ids: z.array(z.object({ id: z.number().int().positive(), role: z.enum(['author', 'reader', 'writer']) }), { error: 'المؤلفون غير صالحين' }).default([]),
  tags: z.array(z.string().trim().min(1, 'كلمة مفتاحية فارغة').max(60, 'الكلمة المفتاحية لا تزيد عن 60 حرفاً'), { error: 'الكلمات المفتاحية غير صالحة' }).max(30, 'الحد الأقصى 30 كلمة مفتاحية').default([]),
}).refine((b) => (b.kind === 'free' ? b.price_amount === 0 : b.price_amount > 0 || b.status === 'draft'), {
  path: ['price_amount'], message: 'الكتاب المدفوع يحتاج سعراً أكبر من صفر، والمجاني سعره صفر',
})
export const adminCategorySchema = z.object({ name: adminName('عنوان القسم', 120), is_active: z.boolean().default(true) })
export const adminMakerSchema = z.object({
  name: adminName('الاسم', 160),
  kind: z.enum(['author', 'reader', 'writer'], { error: 'النوع غير صالح' }),
  era: z.enum(['old', 'new'], { error: 'العصر غير صالح' }),
  bio_html: z.string().max(50_000, 'النبذة طويلة جداً').optional().nullable(),
  is_active: z.boolean().default(true),
})
export const adminArticleSchema = z.object({
  kind: z.enum(['article', 'video', 'ads'], { error: 'نوع المقال غير صالح' }).default('article'),
  title: adminName('العنوان', 250),
  excerpt: z.string().max(1000, 'المقتطف لا يزيد عن 1000 حرف').optional().nullable(),
  content_html: z.string().max(200_000, 'المحتوى طويل جداً').optional().nullable(),
  status: entityStatus,
})
export const adminPageSchema = z.object({
  slug: z.string({ error: 'الرابط مطلوب' }).trim().min(1, 'الرابط مطلوب').regex(/^[^\s/]+$/, 'الرابط لا يحتوي مسافات أو /').max(120, 'الرابط لا يزيد عن 120 حرفاً'),
  title: adminName('العنوان', 250),
  content_html: z.string().max(200_000, 'المحتوى طويل جداً').optional().nullable(),
  positions: z.array(z.enum(['header', 'footer']), { error: 'مكان الظهور غير صالح' }).default([]),
  status: entityStatus,
})
/** A social/profile link: empty, or an http(s) URL (a `javascript:` or `data:` link would otherwise reach the storefront footer). */
const socialUrl = z.string().max(300, 'الرابط لا يزيد عن 300 حرف').optional().nullable().refine((v) => {
  const t = (v ?? '').trim()
  if (!t) return true
  try { return ['http:', 'https:'].includes(new URL(t).protocol) } catch { return false }
}, 'الرابط غير صالح: يجب أن يبدأ بـ https://')
export const adminSettingsSchema = z.object({
  site_name: adminName('اسم الموقع', 120),
  phone: z.string().max(40, 'رقم الهاتف لا يزيد عن 40 حرفاً').optional().nullable(),
  email: z.string().email('البريد الإلكتروني غير صالح').optional().nullable().or(z.literal('')),
  description: z.string().max(500, 'الوصف لا يزيد عن 500 حرف').optional().nullable(),
  keywords: z.string().max(500, 'الكلمات المفتاحية لا تزيد عن 500 حرف').optional().nullable(),
  facebook: socialUrl, twitter: socialUrl, instagram: socialUrl, youtube: socialUrl, telegram: socialUrl, linkedin: socialUrl,
  whatsapp: z.string().max(300, 'رقم الواتساب لا يزيد عن 300 حرف').optional().nullable(),
  show_free_book_button: z.boolean(),
  affiliate_commission_percent: z.number({ error: 'نسبة العمولة غير صالحة' }).min(0, 'نسبة العمولة بين 0 و 100').max(100, 'نسبة العمولة بين 0 و 100'),
  commission_freeze_days: z.number({ error: 'أيام التجميد غير صالحة' }).int('أيام التجميد رقم صحيح').min(0, 'أيام التجميد بين 0 و 365').max(365, 'أيام التجميد بين 0 و 365'),
  min_withdrawal_amount: z.number({ error: 'الحد الأدنى للسحب غير صالح' }).min(0, 'الحد الأدنى للسحب لا يمكن أن يكون سالباً').max(1_000_000, 'الحد الأدنى للسحب كبير جداً'),
})
export const decisionSchema = z.object({ approve: z.boolean(), note: z.string().max(1000).optional().nullable() })

export type CheckoutInput = z.infer<typeof checkoutSchema>
export type AdminBookInput = z.infer<typeof adminBookSchema>
