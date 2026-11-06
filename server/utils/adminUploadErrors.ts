import { createError } from 'h3'

export const createErrorStatus = (statusCode: number, statusMessage: string) => createError({ statusCode, statusMessage })
