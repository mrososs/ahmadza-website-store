import type { H3Event } from 'h3'
import { readMultipartFormData } from 'h3'
import { createHash } from 'node:crypto'
import { badRequest, createErrorStatus } from './adminUploadErrors'
import { contentLength } from './adminRoute'

// Content inspection for admin uploads: the extension and the browser-supplied MIME type are NEVER trusted.
// Anything that is not a recognised PDF / audio / image by magic bytes, or that carries a script/payload marker, is refused.
// (July-2026 hostile payloads in the legacy upload folder: phar stubs, MVG scripts, .htaccess directives, PHP in MP4.)

export type SniffedKind = 'pdf' | 'png' | 'jpg' | 'webp' | 'mp3' | 'm4a' | 'ogg' | 'wav'
export interface Sniffed { kind: SniffedKind; mime: string; ext: string; group: 'pdf' | 'audio' | 'image' }

const startsWith = (b: Buffer, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v)

export function sniffAdminUpload(b: Buffer): Sniffed | null {
  if (b.length < 12) return null
  if (startsWith(b, [0x25, 0x50, 0x44, 0x46, 0x2d])) return { kind: 'pdf', mime: 'application/pdf', ext: 'pdf', group: 'pdf' }
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { kind: 'png', mime: 'image/png', ext: 'png', group: 'image' }
  if (startsWith(b, [0xff, 0xd8, 0xff])) return { kind: 'jpg', mime: 'image/jpeg', ext: 'jpg', group: 'image' }
  if (startsWith(b, [0x52, 0x49, 0x46, 0x46]) && b.toString('latin1', 8, 12) === 'WEBP') return { kind: 'webp', mime: 'image/webp', ext: 'webp', group: 'image' }
  if (startsWith(b, [0x52, 0x49, 0x46, 0x46]) && b.toString('latin1', 8, 12) === 'WAVE') return { kind: 'wav', mime: 'audio/wav', ext: 'wav', group: 'audio' }
  if (startsWith(b, [0x4f, 0x67, 0x67, 0x53])) return { kind: 'ogg', mime: 'audio/ogg', ext: 'ogg', group: 'audio' }
  if (b.toString('latin1', 4, 8) === 'ftyp') return { kind: 'm4a', mime: 'audio/mp4', ext: 'm4a', group: 'audio' }
  if (startsWith(b, [0x49, 0x44, 0x33]) || (b[0] === 0xff && (b[1]! & 0xe0) === 0xe0)) return { kind: 'mp3', mime: 'audio/mpeg', ext: 'mp3', group: 'audio' }
  return null
}

const HOSTILE = [
  '<?php', '<?=', '<script', '__halt_compiler', 'push graphic-context', 'addtype ', 'addhandler ', 'auto_prepend_file',
  'system($_', 'eval(', 'base64_decode(', '<%@', '#!/',
]

/** True when the first 64 KiB (or the tail for PDFs, where payloads like to hide) contains a script / server-config marker. */
export function looksHostile(b: Buffer): boolean {
  const head = b.toString('latin1', 0, Math.min(b.length, 65536)).toLowerCase()
  const tail = b.length > 65536 ? b.toString('latin1', b.length - 8192).toLowerCase() : ''
  return HOSTILE.some((m) => head.includes(m) || tail.includes(m))
}

export interface UploadedFile { buffer: Buffer; sniffed: Sniffed; sha256: string; size: number; fields: Record<string, string> }

interface Opts { groups: Sniffed['group'][]; maxBytes: number }

export async function readAdminUpload(event: H3Event, opts: Opts): Promise<UploadedFile> {
  // reject early on the declared size (plus multipart overhead), then check the real size
  if (contentLength(event) > opts.maxBytes + 64 * 1024) throw createErrorStatus(413, 'حجم الملف أكبر من المسموح')
  const parts = await readMultipartFormData(event)
  if (!parts) throw badRequest('الطلب يجب أن يكون multipart/form-data')
  const filePart = parts.find((p) => p.name === 'file' && p.filename)
  if (!filePart) throw badRequest('لم يتم إرفاق ملف')
  const buffer = filePart.data
  if (buffer.length === 0) throw badRequest('الملف فارغ')
  if (buffer.length > opts.maxBytes) throw createErrorStatus(413, 'حجم الملف أكبر من المسموح')
  const sniffed = sniffAdminUpload(buffer)
  if (!sniffed || !opts.groups.includes(sniffed.group)) throw createErrorStatus(415, 'نوع الملف غير مسموح (يُفحص المحتوى وليس الامتداد)')
  if (looksHostile(buffer)) throw createErrorStatus(415, 'الملف يحتوي على محتوى غير آمن')
  const fields: Record<string, string> = {}
  for (const p of parts) if (p.name && !p.filename) fields[p.name] = p.data.toString('utf8')
  return { buffer, sniffed, sha256: createHash('sha256').update(buffer).digest('hex'), size: buffer.length, fields }
}

/** Rough PDF page count (legacy CAT-13 counted pages server-side). */
export function countPdfPages(b: Buffer): number {
  const m = b.toString('latin1').match(/\/Type\s*\/Page(?![s\w])/g)
  return m ? m.length : 0
}
