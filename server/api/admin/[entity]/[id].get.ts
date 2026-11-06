import { entityCfg, getEntity } from '../../../services/adminCrud'

export default defineEventHandler(async (event) => {
  await adminRead(event)
  return getEntity(event, entityCfg(event.context.params?.entity), intParam(event, 'id'))
})
