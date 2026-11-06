import { adminSettingsFullSchema } from '~~/shared/schemas/admin'

// Only whitelisted columns are written (allow_test_payments and pending_owner_confirmation are NOT editable here).
export default defineEventHandler(async (event) => {
  const admin = await adminWrite(event)
  const s = await parseBody(event, adminSettingsFullSchema)
  const { error } = await serviceClient(event).from('site_settings').update({
    ...s,
    email: s.email || null,
    updated_by: admin.id,
    updated_at: new Date().toISOString(),
  }).eq('id', 1)
  if (error) dbFail(error)
  await adminAudit(event, admin, 'settings_update', 'site_settings', 1, {
    commission: s.affiliate_commission_percent, freeze_days: s.commission_freeze_days, min_withdrawal: s.min_withdrawal_amount,
    payment_mode: s.payment_mode, require_admin_mfa: s.require_admin_mfa,
  })
  return { ok: true }
})
