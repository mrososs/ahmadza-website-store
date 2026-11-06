import { createError } from 'h3'
import { getProvider } from '~~/server/services/payments'
import type { DataMode } from '~~/server/services/payments'
import { settle } from '~~/server/services/payments/settle'

// Reconciliation for a payment whose webhook never arrived: ask the GATEWAY (not the customer, not the admin) what happened, and settle through the same
// idempotent path as a webhook. Only Tap offers a documented, verifiable status query; for Paymob no inquiry endpoint was found in the public docs, so
// nothing is guessed: the admin is told to check Paymob's dashboard instead.
export default defineEventHandler(async (event) => {
  const admin = await adminWrite(event)
  const id = getRouterParam(event, 'id') ?? ''
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw badRequest('معرّف غير صالح')
  const db = serviceClient(event)
  const { data: pay } = await db.from('payments').select('id,provider,provider_order_id,mode,status').eq('id', id).maybeSingle()
  if (!pay) throw notFound('عملية الدفع غير موجودة')
  if (pay.status !== 'pending') return { status: pay.status, outcome: 'unchanged' }
  const provider = getProvider(pay.provider)
  if (provider.id !== 'tap' || !provider.verifyReturn) throw createError({ statusCode: 409, statusMessage: 'لا توجد طريقة موثّقة للاستعلام عن هذه العملية من البوابة. راجع لوحة البوابة مباشرة.' })
  if (!pay.provider_order_id) throw createError({ statusCode: 409, statusMessage: 'لم تُنشأ جلسة دفع لدى البوابة لهذه العملية' })
  const hook = await provider.verifyReturn({ tap_id: pay.provider_order_id }, useRuntimeConfig(event), [pay.mode as DataMode])
  if (!hook) throw createError({ statusCode: 502, statusMessage: 'تعذر الحصول على حالة العملية من البوابة' })
  const r = await settle(event, provider, hook)
  await adminAudit(event, admin, 'payment.recheck', 'payments', id, { outcome: r.outcome })
  const { data: after } = await db.from('payments').select('status').eq('id', id).single()
  return { status: after?.status ?? pay.status, outcome: r.outcome }
})
