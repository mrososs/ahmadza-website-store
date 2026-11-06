import { entityCfg, setDeleted } from '../../../services/adminCrud'

// SOFT delete only (deleted_at). Hard deletes never happen from the admin UI (legacy FK cascades could erase purchases).
export default defineEventHandler(async (event) => {
  const admin = await adminWrite(event)
  const cfg = entityCfg(event.context.params?.entity)
  const id = intParam(event, 'id')
  await setDeleted(event, cfg, id, true)
  await adminAudit(event, admin, 'soft_delete', cfg.table, id)
  return { ok: true }
})
