import { adminBulkBooksSchema } from '~~/shared/schemas/admin'
import { bulkUpdateBooks } from '../../../services/adminBooks'

// Bulk free / paid / soft delete. Per-book audit entries are written by the database function in the same transaction as the change.
export default defineEventHandler(async (event) => {
  const admin = await adminWrite(event)
  const input = await parseBody(event, adminBulkBooksSchema)
  return bulkUpdateBooks(event, admin, input)
})
