// What an image file REALLY is, read from its first bytes (never from its extension): the type and, where the header says so, the pixel size.
// Used to validate recovered cover files before anything is hashed into a report or uploaded. Pure, no file access. (Erasable TypeScript only, so Node can run it directly.)

export type ImageType = 'jpeg' | 'png' | 'webp' | 'gif'
export interface ImageInfo { type: ImageType; mime: string; width: number | null; height: number | null }

const MIME: Record<ImageType, string> = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' }

function jpegSize(b: Uint8Array): { w: number; h: number } | null {
  let i = 2
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i++; continue }
    const m = b[i + 1]!
    if (m === 0xff) { i++; continue }
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: (b[i + 5]! << 8) | b[i + 6]!, w: (b[i + 7]! << 8) | b[i + 8]! }
    i += 2 + ((b[i + 2]! << 8) | b[i + 3]!)
  }
  return null
}

const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to))
const u16 = (b: Uint8Array, o: number) => b[o]! | (b[o + 1]! << 8)
const u24 = (b: Uint8Array, o: number) => b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16)

function webpSize(b: Uint8Array): { w: number; h: number } | null {
  const kind = ascii(b, 12, 16)
  if (kind === 'VP8 ') return b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a ? { w: u16(b, 26) & 0x3fff, h: u16(b, 28) & 0x3fff } : null
  if (kind === 'VP8L') { if (b[20] !== 0x2f) return null; const v = (b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24)) >>> 0; return { w: (v & 0x3fff) + 1, h: ((v >>> 14) & 0x3fff) + 1 } }
  if (kind === 'VP8X') return { w: u24(b, 24) + 1, h: u24(b, 27) + 1 }
  return null
}

/** The type and size of an image from its bytes, or null when the bytes are not a JPEG, PNG, WebP or GIF. */
export function readImageInfo(b: Uint8Array): ImageInfo | null {
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) { const s = jpegSize(b); return { type: 'jpeg', mime: MIME.jpeg, width: s?.w ?? null, height: s?.h ?? null } }
  if (b.length >= 24 && ascii(b, 1, 4) === 'PNG' && b[0] === 0x89) return { type: 'png', mime: MIME.png, width: ((b[16]! << 24) | (b[17]! << 16) | (b[18]! << 8) | b[19]!) >>> 0, height: ((b[20]! << 24) | (b[21]! << 16) | (b[22]! << 8) | b[23]!) >>> 0 }
  if (b.length >= 30 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') { const s = webpSize(b); return { type: 'webp', mime: MIME.webp, width: s?.w ?? null, height: s?.h ?? null } }
  if (b.length >= 10 && (ascii(b, 0, 6) === 'GIF87a' || ascii(b, 0, 6) === 'GIF89a')) return { type: 'gif', mime: MIME.gif, width: u16(b, 6), height: u16(b, 8) }
  return null
}
