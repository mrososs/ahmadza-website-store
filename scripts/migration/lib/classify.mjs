// Content-based media classification (magic bytes, never the extension alone) + hostile-marker scanning.
// Pure functions: no I/O, no execution of any recovered content.

export const SCOPES = {
  product: 'storage/app/public/product_media/',
  editor: 'public/uploads/editor/',
}
export const MAX_OBJECT_BYTES = 100 * 1024 * 1024 // legacy-staging / private-products bucket limit
export const MIN_IMAGE_BYTES = 256 // smaller "images" are polyglot / probe candidates (docs/legacy-audit/09 §5)
export const MIN_VIDEO_BYTES = 1024

const ALLOWED_BY_SCOPE = {
  product: new Set(['pdf', 'mp3']),
  editor: new Set(['png', 'jpeg', 'gif', 'webp', 'mp4']),
}
const EXT_FOR_TYPE = {
  pdf: ['pdf'], mp3: ['mp3'], png: ['png'], jpeg: ['jpg', 'jpeg'], gif: ['gif'], webp: ['webp'], mp4: ['mp4'],
}
export const MIME_FOR_TYPE = {
  pdf: 'application/pdf', mp3: 'audio/mpeg', png: 'image/png', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', mp4: 'video/mp4',
}

/** Detect a type from the first bytes. @param {Uint8Array} head */
export function sniffType(head, size = head.length) {
  const b = Buffer.from(head.buffer, head.byteOffset, head.length)
  if (size === 0) return 'empty'
  const ascii = (s, o = 0) => b.subarray(o, o + s.length).toString('latin1') === s
  if (ascii('%PDF-')) return 'pdf'
  if (b.length >= 8 && b[0] === 0x89 && ascii('PNG\r\n\x1a\n', 1)) return 'png'
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg'
  if (ascii('GIF87a') || ascii('GIF89a')) return 'gif'
  if (ascii('RIFF') && ascii('WEBP', 8)) return 'webp'
  if (ascii('ID3') || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return 'mp3'
  if (ascii('ftyp', 4)) return 'mp4'
  if (ascii('BM')) return 'bmp'
  const text = b.subarray(0, 512).toString('latin1')
  if (/^\s*<\?xml/i.test(text) || /^\s*<svg/i.test(text)) return /<svg/i.test(text) ? 'svg' : 'xml'
  if (/^\s*(<!doctype html|<html)/i.test(text)) return 'html'
  if (/<\?(php|=)/i.test(text)) return 'php'
  if (ascii('push graphic-context')) return 'mvg'
  // heuristically textual => 'text'
  let printable = 0
  for (const c of b.subarray(0, 512)) if (c === 9 || c === 10 || c === 13 || (c >= 32 && c < 127)) printable++
  if (b.length && printable / Math.min(b.length, 512) > 0.95) return 'text'
  return 'unknown'
}

const P = (s) => Buffer.from(s, 'latin1')
export const STRONG_MARKERS = [
  ['php-open-tag', P('<?php')], ['php-open-tag', P('<?PHP')], ['phar-stub', P('__HALT_COMPILER')],
  ['imagemagick-mvg', P('push graphic-context')], ['apache-directive', P('auto_prepend_file')],
  ['apache-directive', P('AddHandler')], ['apache-directive', P('x-httpd-php')],
]
export const WEAK_MARKERS = [
  ['php-short-tag', P('<?=')], ['script-tag', P('<script')], ['php-call', P('eval(')], ['php-call', P('system(')],
  ['php-call', P('base64_decode(')], ['shell-call', P('curl ')], ['shell-call', P('wget ')],
]
// Weak markers (e.g. "<?=", 3 bytes) occur by chance in compressed image data: only meaningful in tiny probe files.
export const WEAK_SCAN_MAX_BYTES = 64 * 1024

/**
 * Streaming marker scanner (handles matches split across chunk boundaries).
 * Weak markers are only applied to small non-PDF files, where random-byte false positives are impossible to matter.
 */
export class MarkerScanner {
  /** @param {{ weak: boolean }} opts */
  constructor({ weak }) {
    this.markers = weak ? [...STRONG_MARKERS, ...WEAK_MARKERS] : STRONG_MARKERS
    this.keep = Math.max(...this.markers.map(([, p]) => p.length)) - 1
    this.tail = Buffer.alloc(0)
    this.hits = new Set()
  }
  update(chunk) {
    const buf = this.tail.length ? Buffer.concat([this.tail, chunk]) : chunk
    for (const [name, pat] of this.markers) if (buf.includes(pat)) this.hits.add(name)
    this.tail = buf.subarray(Math.max(0, buf.length - this.keep))
    return this
  }
  get found() { return [...this.hits] }
}

export function scanBuffer(buf, opts) { return new MarkerScanner(opts).update(buf).found }

const baseName = (p) => p.slice(p.lastIndexOf('/') + 1)

/** Path hygiene for entries coming out of an untrusted archive. */
export function unsafePathReason(p) {
  if (p.includes('\0')) return 'NUL in path'
  if (p.startsWith('/') || /^[A-Za-z]:/.test(p)) return 'absolute path'
  if (p.includes('\\')) return 'backslash in path'
  if (p.split('/').some((s) => s === '..')) return 'path traversal'
  // eslint-disable-next-line no-control-regex -- control chars are exactly what is being rejected
  if (/[<>:"|?*\x00-\x1f]/.test(p)) return 'characters invalid on Windows'
  if (p.split('/').some((s) => /[. ]$/.test(s) && s !== '')) return 'trailing dot/space segment'
  if (p.length > 200) return 'path too long'
  return null
}

/**
 * Decide whether a file is acceptable for quarantine/staging.
 * @param {{ path: string, size: number, head: Uint8Array, markers?: string[] }} f
 * @returns {{ scope: 'product'|'editor'|null, detected_type: string, accepted: boolean, reasons: string[] }}
 */
export function classifyFile({ path, size, head, markers = [] }) {
  const reasons = []
  const bad = unsafePathReason(path)
  if (bad) reasons.push(bad)
  const scope = path.startsWith(SCOPES.product) ? 'product' : path.startsWith(SCOPES.editor) ? 'editor' : null
  if (!scope) reasons.push('outside the expected upload folders')

  const detected_type = sniffType(head, size)
  const name = baseName(path)
  const lower = name.toLowerCase()
  const ext = lower.includes('.') ? lower.split('.').pop() : ''
  if (lower.startsWith('.')) reasons.push('dotfile (.htaccess-style) is never allowed')
  if (/\.(php\d?|phtml|phar|pht|inc|sh|cgi|pl|py|jsp|asp|aspx|exe|bat|cmd|js|html?)(\.|$)/i.test(lower)) reasons.push('executable/server-side extension')
  if (size === 0) reasons.push('zero-byte file')
  if (scope && !ALLOWED_BY_SCOPE[scope].has(detected_type)) reasons.push(`content type "${detected_type}" is not allow-listed for ${scope}`)
  if (ALLOWED_BY_SCOPE[scope ?? 'product'].has(detected_type) && !EXT_FOR_TYPE[detected_type]?.includes(ext)) {
    reasons.push(`extension ".${ext || '(none)'}" does not match content "${detected_type}"`)
  }
  if (['png', 'jpeg', 'gif', 'webp'].includes(detected_type) && size < MIN_IMAGE_BYTES) reasons.push(`image below ${MIN_IMAGE_BYTES} B (probe/polyglot candidate)`)
  if (detected_type === 'mp4' && size < MIN_VIDEO_BYTES) reasons.push(`video below ${MIN_VIDEO_BYTES} B`)
  if (markers.length) reasons.push(`hostile markers inside content: ${markers.join(', ')}`)
  return { scope, detected_type, accepted: reasons.length === 0, reasons }
}

export const oversize = (size) => size > MAX_OBJECT_BYTES
