import { RECOVERED_PAGE_SIZE, recoveredPage, recoveredPreviewEnabled } from '../../../services/recoveredPreview'

// The recovered catalogue under review (protected preview only). Whitelisted fields, no storage path, no author, no price, no cover.
export default defineEventHandler(async (event) => {
  setHeader(event, 'cache-control', 'private, no-store')
  if (!recoveredPreviewEnabled(event)) throw createError({ statusCode: 404, statusMessage: 'غير متاح' })
  const q = getQuery(event)
  const page = Math.min(Math.max(1, Number.parseInt(String(q.page ?? '1'), 10) || 1), 10_000)
  const size = Math.min(Math.max(1, Number.parseInt(String(q.limit ?? RECOVERED_PAGE_SIZE), 10) || RECOVERED_PAGE_SIZE), RECOVERED_PAGE_SIZE)
  const search = (typeof q.search === 'string' ? q.search : '').trim().slice(0, 80)
  return { enabled: true, ...(await recoveredPage(event, { page, size, search })) }
})
