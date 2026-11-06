import { createError } from 'h3'
export { badRequest } from './errors'

export const createErrorStatus = (statusCode: number, statusMessage: string) => createError({ statusCode, statusMessage })
