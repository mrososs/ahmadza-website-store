import { recoveryPromoteSchema } from '~~/shared/schemas/admin'
import { promoteEligible } from '../../../services/adminRecovery'

// Publishes ONLY drafts that satisfy the whole publication rule, at their original legacy status. Paid checkout is a separate switch.
export default defineEventHandler(async (event) => {
  const admin = await adminWrite(event)
  const body = await parseBody(event, recoveryPromoteSchema)
  const res = await promoteEligible(event, body.run)
  await adminAudit(event, admin, 'recovery.promote_eligible', 'books', body.run ?? 'all', { promoted: res.promoted })
  return res
})
