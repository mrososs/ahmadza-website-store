import { z } from 'zod'

const optionalText = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null))

/** Legacy withdraw_types: PayPal (typo "paypall" normalised) or bank transfer. */
export const payoutMethodUpsertSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('paypal'),
    email: z.string().trim().toLowerCase().email('البريد الإلكتروني غير صالح').max(254),
    is_active: z.boolean().default(true),
  }),
  z.object({
    kind: z.literal('bank_transfer'),
    iban: z.string().trim().min(8, 'رقم الـ IBAN غير صالح').max(40).regex(/^[A-Za-z0-9 ]+$/, 'رقم الـ IBAN غير صالح'),
    account_number: z.string().trim().min(3).max(40),
    name: z.string().trim().min(2).max(120),
    bank_name: z.string().trim().min(2).max(120),
    is_active: z.boolean().default(true),
  }),
])
export type PayoutMethodInput = z.infer<typeof payoutMethodUpsertSchema>

export const affiliateStatusSchema = z.object({ status: z.enum(['active', 'review', 'banned']) })
export const affiliatePromoteSchema = z.object({ email: z.string().trim().toLowerCase().email().max(254) })

/** Fields of the request-book form (files are validated separately from the multipart parts). */
export const contributorFormSchema = z.object({
  name: z.string().trim().min(2, 'إسم الكتاب مطلوب').max(200),
  type: z.enum(['paid', 'free']),
  cost: z.coerce.number().min(0).max(100000).default(0),
  iban: z.string().trim().min(8, 'رقم الـ IBAN مطلوب').max(64),
  whatsapp: z.string().trim().min(5, 'رقم الواتساب مطلوب').max(32),
  deal: z.enum(['share', 'rent']),
  about: z.string().trim().min(5, 'اكتب عن الكتاب').max(5000),
  maker: z.string().trim().min(2, 'اكتب نبذة عن المؤلف').max(5000),
  agree: z.union([z.literal('1'), z.literal('true'), z.literal(true)], { message: 'يجب الموافقة على اتفاقية النشر' }),
}).refine((v) => (v.type === 'paid' ? v.cost > 0 : true), { path: ['cost'], message: 'الكتاب المدفوع يحتاج سعراً أكبر من صفر' })

export const withdrawalAmountSchema = z.object({ amount: z.coerce.number().positive().max(1_000_000) })
export const adminDecisionSchema = z.object({
  approve: z.union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')]),
  note: optionalText(1000),
})
export { optionalText }
