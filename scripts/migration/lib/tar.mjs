// Minimal, dependency-free, READ-ONLY tar reader (ustar + GNU long names + pax path/size).
// It never extracts anything by itself: it yields entry descriptors and lets the caller stream selected data.
import { open } from 'node:fs/promises'
import { createReadStream } from 'node:fs'

const BLOCK = 512

const cstr = (buf, start, len) => {
  const slice = buf.subarray(start, start + len)
  const nul = slice.indexOf(0)
  return slice.subarray(0, nul === -1 ? slice.length : nul).toString('utf8')
}

function parseNumber(buf, start, len) {
  if (buf[start] & 0x80) { // GNU base-256
    let n = BigInt(buf[start] & 0x7f)
    for (let i = 1; i < len; i++) n = (n << 8n) | BigInt(buf[start + i])
    return Number(n)
  }
  const s = cstr(buf, start, len).trim()
  return s ? parseInt(s, 8) : 0
}

export function headerChecksumOk(h) {
  let sum = 0
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : h[i]
  return sum === parseNumber(h, 148, 8)
}

function parsePax(data) {
  const out = {}
  let i = 0
  while (i < data.length) {
    const sp = data.indexOf(0x20, i)
    if (sp === -1) break
    const len = parseInt(data.subarray(i, sp).toString('ascii'), 10)
    if (!Number.isFinite(len) || len <= 0) break
    const rec = data.subarray(sp + 1, i + len - 1).toString('utf8') // strip trailing \n
    const eq = rec.indexOf('=')
    if (eq > 0) out[rec.slice(0, eq)] = rec.slice(eq + 1)
    i += len
  }
  return out
}

/**
 * @typedef {{ name: string, size: number, type: string, mtime: number, linkname: string, dataOffset: number }} TarEntry
 * type: '0' regular, '5' directory, '1' hardlink, '2' symlink, anything else = special (never extracted)
 */

/** Iterate entries of a tar file. @param {string} file @returns {AsyncGenerator<TarEntry>} */
export async function* readTar(file) {
  const fh = await open(file, 'r')
  try {
    const { size: fileSize } = await fh.stat()
    const h = Buffer.alloc(BLOCK)
    let pos = 0
    let longName = null
    let pax = {}
    let zeroBlocks = 0
    while (pos + BLOCK <= fileSize) {
      await fh.read(h, 0, BLOCK, pos)
      pos += BLOCK
      if (h.every((b) => b === 0)) { if (++zeroBlocks >= 2) break; continue }
      zeroBlocks = 0
      if (!headerChecksumOk(h)) throw new Error(`tar header checksum mismatch at offset ${pos - BLOCK}`)
      let name = cstr(h, 0, 100)
      const prefix = cstr(h, 345, 155)
      if (prefix && cstr(h, 257, 5) === 'ustar') name = `${prefix}/${name}`
      let size = parseNumber(h, 124, 12)
      const type = String.fromCharCode(h[156] || 0x30)
      const mtime = parseNumber(h, 136, 12)
      const linkname = cstr(h, 157, 100)
      const dataPad = Math.ceil(size / BLOCK) * BLOCK

      if (type === 'L' || type === 'K' || type === 'x' || type === 'g') {
        const meta = Buffer.alloc(size)
        await fh.read(meta, 0, size, pos)
        pos += dataPad
        if (type === 'L') longName = cstr(meta, 0, size)
        else if (type === 'x') pax = { ...pax, ...parsePax(meta) }
        continue
      }
      if (longName) { name = longName; longName = null }
      if (pax.path) name = pax.path
      if (pax.size) size = parseInt(pax.size, 10)
      pax = {}
      yield { name, size, type, mtime, linkname, dataOffset: pos }
      pos += Math.ceil(size / BLOCK) * BLOCK
    }
  } finally { await fh.close() }
}

/** Stream the data of one entry (read-only). */
export const entryStream = (file, entry, opts = {}) =>
  createReadStream(file, { start: entry.dataOffset, end: entry.dataOffset + entry.size - 1, ...opts })
