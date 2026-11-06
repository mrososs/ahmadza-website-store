import { adminListQuerySchema } from '~~/shared/schemas/admin'
import { entityCfg, listEntity } from '../../../services/adminCrud'

export default defineEventHandler(async (event) => {
  await adminRead(event)
  const cfg = entityCfg(event.context.params?.entity)
  return listEntity(event, cfg, parseQuery(event, adminListQuerySchema))
})
