import { contactRequestSchema } from '~~/shared/schemas/storefront'
import { badRequest } from '../utils/errors'
import { rateLimit } from '../utils/rateLimit'
import { getOptionalUser, serviceClient } from '../utils/supabase'

// Public contact form (legacy POST /contact). Validated, rate limited, honeypot-protected; written with the service role
// because contact_messages has no Data API write policy.
export default defineEventHandler(async (event) => {
  rateLimit(event, 'contact', 5, 10 * 60_000)
  const parsed = contactRequestSchema.safeParse(await readBody(event))
  if (!parsed.success) throw badRequest('بيانات غير صالحة', parsed.error.flatten().fieldErrors)
  const { website, ...msg } = parsed.data
  // honeypot: pretend success so bots learn nothing, store nothing
  if (website) return { ok: true }
  const user = await getOptionalUser(event)
  const { error } = await serviceClient(event).from('contact_messages').insert({ ...msg, user_id: user?.id ?? null })
  if (error) throw createError({ statusCode: 500, statusMessage: 'تعذر إرسال الرسالة' })
  return { ok: true }
})
