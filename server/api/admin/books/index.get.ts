import { adminListQuerySchema } from '~~/shared/schemas/admin'
import { listBooks } from '../../../services/adminBooks'

export default defineEventHandler(async (event) => {
  await adminRead(event)
  return listBooks(event, parseQuery(event, adminListQuerySchema))
})
