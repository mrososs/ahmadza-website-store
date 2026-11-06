import { serviceClient } from '../../utils/supabase'

// Public program info for the /affiliate-register banner. The percentage is a configurable setting that is still
// pending owner confirmation (docs/legacy-audit/16) — it is read from site_settings, never hard-coded.
export default defineEventHandler(async (event) => {
  const { data } = await serviceClient(event).from('site_settings')
    .select('affiliate_commission_percent').eq('id', 1).maybeSingle()
  return { percent: Number(data?.affiliate_commission_percent ?? 0) }
})
