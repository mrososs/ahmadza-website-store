export default defineEventHandler(async (event) => {
  const admin = await adminRead(event, { allowAal1: true }) // the one admin route that answers before the second factor, so the UI knows where to send the admin
  const required = adminMfaRequired(event)
  const { data } = await serviceClient(event).from('profiles').select('display_name').eq('id', admin.id).maybeSingle()
  return { id: admin.id, email: admin.email, displayName: data?.display_name ?? '', mfa: { required, aal: admin.aal ?? 'aal1', satisfied: !required || admin.aal === 'aal2' } }
})
