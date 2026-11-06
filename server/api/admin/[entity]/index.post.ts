import { createEntity, entityCfg } from '../../../services/adminCrud'

export default defineEventHandler(async (event) => {
  const admin = await adminWrite(event)
  const cfg = entityCfg(event.context.params?.entity)
  const created = await createEntity(event, cfg, await parseBody(event, cfg.schema))
  await adminAudit(event, admin, 'create', cfg.table, created.id)
  setResponseStatus(event, 201)
  return created
})
