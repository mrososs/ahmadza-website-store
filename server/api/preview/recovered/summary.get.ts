import { recoveredPreviewEnabled, recoveredTotal } from '../../../services/recoveredPreview'

// Whether the protected preview has recovered books under review, and how many. Answers 200 either way so a page can ask without an error when the site is public.
export default defineEventHandler(async (event) => {
  setHeader(event, 'cache-control', 'private, no-store')
  if (!recoveredPreviewEnabled(event)) return { enabled: false, total: 0 }
  return { enabled: true, total: await recoveredTotal(event) }
})
