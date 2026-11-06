import { RECOVERY_VERIFY_PHRASE } from '~~/shared/constants/recovery'
import { recoveryVerifySchema } from '~~/shared/schemas/admin'
import { verifyRun } from '../../../services/adminRecovery'

// Marks every book of one import run as "verified genuine legacy data". It does NOT publish anything; promotion is a separate, explicit step.
export default defineEventHandler(async (event) => {
  const admin = await adminWrite(event)
  const body = await parseBody(event, recoveryVerifySchema)
  if (body.confirm !== RECOVERY_VERIFY_PHRASE) throw badRequest('عبارة التأكيد غير صحيحة')
  const res = await verifyRun(event, body.run, admin.id)
  await adminAudit(event, admin, 'recovery.verify_run', 'migration_runs', body.run, { verified: res.verified })
  return res
})
