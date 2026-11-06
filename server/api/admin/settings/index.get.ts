// ADM-10: full settings row (admin only). `pending_owner_confirmation` lists commercial values not yet confirmed by the owner.
export default defineEventHandler(async (event) => {
  await adminRead(event)
  const { data, error } = await serviceClient(event).from('site_settings').select('*').eq('id', 1).single()
  if (error) dbFail(error)
  return data
})
