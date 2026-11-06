export default defineEventHandler(async (event) => {
  await adminRead(event)
  const id = intParam(event, 'id')
  const { data, error } = await serviceClient(event).from('book_media')
    .select('id,book_id,kind,visibility,name,extension,page_count,sort_order,is_external,external_url,mime_type,byte_size,sha256,created_at')
    .eq('book_id', id).order('sort_order').order('id')
  if (error) dbFail(error)
  return { items: data ?? [] }
})
