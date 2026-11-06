import type { H3Event, MultiPartData } from 'h3'
import { readMultipartFormData } from 'h3'
import { badRequest } from './errors'

export type SniffedType = 'pdf' | 'png' | 'jpg' | 'webp'
export const MIME: Record<SniffedType, string> = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }

/** Content inspection (magic bytes). The client-declared filename / content-type are never trusted. */
export function sniff(buf: Buffer | Uint8Array): SniffedType | null {
  const b = buf
  if (b.length < 12) return null
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'pdf'
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png'
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg'
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp'
  return null
}

export interface ParsedMultipart { fields: Record<string, string>; files: Record<string, MultiPartData> }

export async function parseMultipart(event: H3Event): Promise<ParsedMultipart> {
  const parts = await readMultipartFormData(event)
  if (!parts) throw badRequest('يجب إرسال النموذج كـ multipart/form-data')
  const fields: Record<string, string> = {}
  const files: Record<string, MultiPartData> = {}
  for (const p of parts) {
    if (!p.name) continue
    if (p.filename !== undefined) { if (p.data.length > 0) files[p.name] = p }
    else fields[p.name] = p.data.toString('utf8')
  }
  return { fields, files }
}

/** Validate one uploaded part: size cap + allowed real types. Returns the sniffed type. */
export function checkFile(part: MultiPartData, label: string, allowed: SniffedType[], maxBytes: number): SniffedType {
  if (part.data.length > maxBytes) throw badRequest(`${label}: الحجم يتجاوز الحد المسموح`)
  const t = sniff(part.data)
  if (!t || !allowed.includes(t)) throw badRequest(`${label}: نوع الملف غير مسموح`)
  return t
}
