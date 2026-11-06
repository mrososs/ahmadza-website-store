import { z } from 'zod'
import { recoveryRejects } from '../../../services/adminRecovery'

export default defineEventHandler(async (event) => {
  await adminRead(event)
  const { page } = parseQuery(event, z.object({ page: z.coerce.number().int().min(1).max(100000).default(1) }))
  return recoveryRejects(event, page)
})
