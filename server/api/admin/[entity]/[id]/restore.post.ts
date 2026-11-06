import { entityCfg, setDeleted } from '../../../../services/adminCrud'

export default defineEventHandler(async (event) => {
  const admin = await adminWrite(event)
  const cfg = entityCfg(event.context.params?.entity)
  const id = intParam(event, 'id')
  await setDeleted(event, cfg, id, false)
  await adminAudit(event, admin, 'restore', cfg.table, id)
  return { ok: true }
})
