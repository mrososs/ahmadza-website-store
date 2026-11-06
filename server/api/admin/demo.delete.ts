import { adminDemoPurgeSchema } from '~~/shared/schemas/admin'

// Removes ALL development seed rows via public.purge_demo_data(). Requires the typed confirmation "DELETE-DEMO".
export default defineEventHandler(async (event) => {
  const admin = await adminWrite(event)
  await parseBody(event, adminDemoPurgeSchema)
  const { error } = await serviceClient(event).rpc('purge_demo_data')
  if (error) dbFail(error)
  await adminAudit(event, admin, 'demo_purge', 'demo_data', 'all')
  return { ok: true }
})
