export default defineEventHandler(async (event) => {
  const admin = await adminRead(event)
  const { data } = await serviceClient(event).from('profiles').select('display_name').eq('id', admin.id).maybeSingle()
  return { id: admin.id, email: admin.email, displayName: data?.display_name ?? '' }
})
