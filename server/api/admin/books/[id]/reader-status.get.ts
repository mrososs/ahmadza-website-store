import { readerAssessment } from '../../../../services/adminBooks'

// Admin-only: can this book be read, and is anything about its files unsafe? Never returns storage paths.
export default defineEventHandler(async (event) => {
  await adminRead(event)
  setResponseHeader(event, 'cache-control', 'private, no-store')
  const { book, assessment } = await readerAssessment(event, intParam(event, 'id'))
  return { kind: book.kind, status: book.status, price_amount: book.price_amount, ...assessment }
})
