// Pure helpers for judging whether the first page of a PDF is a cover. No file access, no process: they read the text and bytes they are given, so they are unit-tested
// without any PDF. The measurements come from Poppler (pdfinfo, pdfimages -list, pdftotext, a small grey render); see generate-pdf-covers.mjs.

/** "Page size: 336.02 x 539.6 pts" (or, with -f/-l, "Page    1 size: 336.02 x 539.6 pts") -> { w, h } in points, or null. */
export function parsePageSize(infoText) {
  const m = /Page(?:\s+\d+)?\s+size:\s*([\d.]+)\s*x\s*([\d.]+)\s*pts/i.exec(infoText ?? '')
  if (!m) return null
  const w = Number(m[1]), h = Number(m[2])
  return Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? { w, h } : null
}

/**
 * `pdfimages -list` table -> the pictures on that page. Columns: page num type width height color comp bpc enc interp objID gen x-ppi y-ppi size ratio.
 * Only real pictures count (type "image"); soft masks and stencil masks are not pictures. coverage(size) is the share of the page they cover (0..1, overlaps capped).
 */
export function parseImageList(text) {
  const images = []
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const t = line.trim().split(/\s+/)
    if (t.length < 14 || !/^\d+$/.test(t[0]) || t[2] !== 'image') continue
    const w = Number(t[3]), h = Number(t[4]), xppi = Number(t[12]), yppi = Number(t[13])
    if (![w, h, xppi, yppi].every((n) => Number.isFinite(n) && n > 0)) continue
    images.push({ w, h, xppi, yppi, areaPts: (w / xppi) * 72 * (h / yppi) * 72 })
  }
  return { images, coverage: (size) => (size ? Math.min(1, images.reduce((s, i) => s + i.areaPts, 0) / (size.w * size.h)) : 0) }
}

/** Binary PGM (P5) from `pdftoppm -gray` -> luminance statistics. A page that is one flat colour is blank. */
export function pgmStats(buf) {
  let i = 0
  const token = () => { while (i < buf.length && /\s/.test(String.fromCharCode(buf[i]))) i++; let s = ''; while (i < buf.length && !/\s/.test(String.fromCharCode(buf[i]))) s += String.fromCharCode(buf[i++]); return s }
  if (token() !== 'P5') throw new Error('not a binary PGM')
  const w = Number(token()), h = Number(token()), max = Number(token())
  i++ // the single whitespace after the header
  const n = w * h
  if (!w || !h || max !== 255 || buf.length - i < n) throw new Error('truncated PGM')
  let sum = 0
  for (let k = 0; k < n; k++) sum += buf[i + k]
  const mean = sum / n
  let sq = 0, light = 0
  for (let k = 0; k < n; k++) { const d = buf[i + k] - mean; sq += d * d; if (buf[i + k] >= 245) light++ }
  const std = Math.sqrt(sq / n)
  return { width: w, height: h, mean, std, lightShare: light / n, blank: std < 5 && (mean > 240 || mean < 15) }
}

/** Width and height from a JPEG's start-of-frame marker, or null when it is not a well-formed JPEG. */
export function jpegSize(buf) {
  if (!buf || buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null
  let i = 2
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i++; continue }
    const marker = buf[i + 1]
    if (marker === 0xff) { i++; continue }
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { h: (buf[i + 5] << 8) | buf[i + 6], w: (buf[i + 7] << 8) | buf[i + 8] }
    i += 2 + ((buf[i + 2] << 8) | buf[i + 3])
  }
  return null
}

/**
 * Is the first page a cover? high: essentially one big picture and almost no text. medium: probably a cover but not clear (a drawn cover, or a picture plus some text).
 * low: a page of text (a title or contents page). blank: nothing to show. Only "high" is ever attached without an administrator.
 */
export function classifyFirstPage({ coverage, letters, blank, aspect }) {
  if (blank) return { class: 'blank', confidence: 'none', reason: 'the first page renders as one flat colour' }
  // A book cover is portrait. `aspect` is the RENDERED height / width (a rotated page that displays upright counts as portrait), so a slide or a banner is never "high".
  if (aspect != null && aspect < 1.1) return { class: 'uncertain', confidence: 'medium', reason: `the first page renders landscape or square (height/width ${aspect.toFixed(2)}): probably not a book cover` }
  if (coverage >= 0.8 && letters <= 120) return { class: 'cover_like', confidence: 'high', reason: `one picture covers ${Math.round(coverage * 100)}% of the page and the page has ${letters} letters` }
  if (coverage >= 0.4 || letters <= 40) return { class: 'uncertain', confidence: 'medium', reason: `pictures cover ${Math.round(coverage * 100)}% of the page and it has ${letters} letters: possibly a cover` }
  return { class: 'text_page', confidence: 'low', reason: `${letters} letters and pictures cover ${Math.round(coverage * 100)}% of the page: more likely a title or text page` }
}
