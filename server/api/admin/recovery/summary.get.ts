import { recoverySummary } from '../../../services/adminRecovery'

export default defineEventHandler(async (event) => {
  await adminRead(event)
  return recoverySummary(event)
})
