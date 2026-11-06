import { entityCfg, updateEntity } from '../../../services/adminCrud'

export default defineEventHandler(async (event) => {
  const admin = await adminWrite(event)
  const cfg = entityCfg(event.context.params?.entity)
  const id = intParam(event, 'id')
  await updateEntity(event, cfg, id, await parseBody(event, cfg.schema))
  await adminAudit(event, admin, 'update', cfg.table, id)
  return { ok: true }
})
