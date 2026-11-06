import { getBook } from '../../../services/adminBooks'

export default defineEventHandler(async (event) => {
  await adminRead(event)
  return getBook(event, intParam(event, 'id'))
})
