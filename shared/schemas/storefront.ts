import { z } from 'zod'
import { contactSchema } from './index'

/** Contact form = shared contactSchema + a honeypot field that real users never fill. */
export const contactRequestSchema = contactSchema.extend({
  website: z.string().max(200).optional().default(''),
})
export type ContactRequest = z.infer<typeof contactRequestSchema>
