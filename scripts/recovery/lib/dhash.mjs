// Perceptual "difference hash" (dHash) of image files: a 64-bit fingerprint of what an image LOOKS like, so a recovered cover can be compared with the first page of a
// book's own PDF even though one is a WebP and the other a JPEG at another size. Chrome decodes the image (it reads WebP, JPEG and PNG), a 9x8 greyscale canvas is
// compared left to right, and the 64 comparisons become 16 hex characters. Files are only READ; nothing is executed or modified.
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { readImageInfo } from '../../../shared/utils/imageInfo.ts'

const MAX_BYTES = 8 * 1024 * 1024

/** Hamming distance between two 16-hex-character hashes (0 = identical look, 64 = opposite). */
export function hammingHex(a, b) {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`), n = 0
  while (x) { n += Number(x & 1n); x >>= 1n }
  return n
}

/** @param {string[]} files absolute paths @returns {Promise<Map<string, string|null>>} hash per file, null for a file that is not a decodable image */
export async function dhashFiles(files, root = process.cwd()) {
  const { chromium } = createRequire(`${root.replace(/\\/g, '/')}/package.json`)('playwright-core')
  const browser = await chromium.launch({ channel: 'chrome' })
  const out = new Map()
  try {
    const page = await browser.newPage()
    await page.setContent('<canvas id="c" width="9" height="8"></canvas>')
    for (const file of files) {
      const bytes = await readFile(file)
      const info = readImageInfo(bytes)
      if (!info || bytes.length > MAX_BYTES || info.type === 'gif') { out.set(file, null); continue }
      const hash = await page.evaluate(async ({ b64, mime }) => {
        const bin = atob(b64); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i)
        let bmp
        try { bmp = await createImageBitmap(new Blob([u8], { type: mime })) } catch { return null }
        const c = document.getElementById('c'); const g = c.getContext('2d', { willReadFrequently: true })
        g.drawImage(bmp, 0, 0, 9, 8)
        const d = g.getImageData(0, 0, 9, 8).data
        const lum = (x, y) => { const i = (y * 9 + x) * 4; return 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2] }
        let bits = ''
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += lum(x, y) < lum(x + 1, y) ? '1' : '0'
        let hex = ''
        for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16)
        return hex
      }, { b64: bytes.toString('base64'), mime: info.mime })
      out.set(file, hash)
    }
  } finally { await browser.close() }
  return out
}
