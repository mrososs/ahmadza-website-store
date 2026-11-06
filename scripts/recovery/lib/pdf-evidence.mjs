// Safe evidence from PDF BYTES. Nothing here renders, executes, decompresses or follows anything inside a file: it only reads bytes
// with bounded memory, looks for a handful of well-known keywords outside stream bodies, and decodes the Info dictionary / XMP title.
//   * every read is bounded: a file is streamed in 1 MiB chunks (never loaded whole) up to FULL_SCAN_LIMIT, above that only the
//     first and last 1 MiB are inspected and the result says so (scan.mode === 'edges')
//   * nothing throws: malformed input returns { ok: false, reason }
//   * metadata that lives inside compressed object streams is invisible to this reader; that is reported, never guessed
import { createHash } from 'node:crypto'
import { open } from 'node:fs/promises'
import { looksMojibake } from './validate-catalog.mjs'

export const WINDOW = 1024 * 1024
export const FULL_SCAN_LIMIT = 512 * 1024 * 1024
const MAX_PAGES = 1_000_000
const MAX_INFO_OBJECTS = 4000
const MAX_XMP_BYTES = 128 * 1024
const MAX_STRING = 4096
const HOLD = 24 // longest keyword we must not split across two chunks

// ---- keyword counting (outside stream bodies only: compressed data would otherwise produce random "/JS" hits) ---------------------------
const FLAG_PATTERNS = {
  javascript: /\/JavaScript(?![A-Za-z0-9])/g,
  js: /\/JS\s*(?:\(|<|\d+\s+\d+\s+R)/g,
  launch: /\/Launch(?![A-Za-z0-9])/g,
  embedded_file: /\/EmbeddedFiles?(?![A-Za-z0-9])/g,
  aa: /\/AA(?=\s*(?:<<|\d+\s+\d+\s+R))/g,
  uri: /\/URI\s*[(<]/g,
}
const STREAM_RE = /stream(?:\r\n|\n|\r)/g
const OBJ_HEAD = /(\d{1,10})\s+(\d{1,5})\s+obj\b([\s\S]*)$/
const INFO_KEYS = /\/(?:Title|Author|Subject|Creator|Producer|CreationDate|ModDate|Keywords)\s*[(<]/
const INFO_KEYS_G = new RegExp(INFO_KEYS.source, 'g')
const MAX_OBJECT = 8192
// "/OpenAction [page /Fit]" is a plain destination and "/S /GoTo" a page jump: neither runs anything. Everything else counts.
const OPEN_ACTION = /\/OpenAction(?![A-Za-z0-9])\s*(\[|<<|(\d+)\s+\d+\s+R)?/g

const decodeNames = (s) => (!s.includes('#') ? s : s.replace(/\/[^\s/[\]<>(){}%]*#[0-9A-Fa-f]{2}[^\s/[\]<>(){}%]*/g, (m) => m.replace(/#([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))))
const countMatches = (re, s) => { re.lastIndex = 0; let n = 0; while (re.exec(s)) n++; return n }

class Scanner {
  constructor({ inStream = false } = {}) {
    this.inStream = inStream
    this.pending = ''
    this.counts = Object.fromEntries([...Object.keys(FLAG_PATTERNS), 'open_action'].map((k) => [k, 0]))
    this.openRefs = []
    this.gotoObjects = new Set()
    this.pageObjects = 0
    this.objectStreams = 0
    this.encryptRefs = 0
    this.pagesRoots = []
    this.infoRefs = []
    this.linearizedPages = null
    this.objects = new Map() // 'num gen' -> body of dictionary objects that carry Info-like keys
    this.xmp = null
    this.capture = null
  }

  push(buf) {
    const s = this.pending + buf.toString('latin1')
    this.pending = ''
    let pos = 0
    while (pos < s.length) {
      if (this.inStream) {
        const i = s.indexOf('endstream', pos)
        if (this.capture !== null) this.capture += s.slice(pos, i === -1 ? Math.max(pos, s.length - 9) : i).slice(0, Math.max(0, MAX_XMP_BYTES - this.capture.length))
        if (i === -1) { this.pending = s.slice(Math.max(pos, s.length - 9)); return }
        if (this.capture !== null) { this.xmp = this.capture; this.capture = null }
        this.inStream = false
        pos = i + 9
      } else {
        STREAM_RE.lastIndex = pos
        const m = STREAM_RE.exec(s)
        if (!m) {
          // hold back the tail so a keyword is never split between two counted pieces: cut after the last "endobj" (or line break) when there is one
          let cut = Math.max(pos, s.length - HOLD)
          const obj = s.lastIndexOf('endobj', cut)
          const nl = Math.max(s.lastIndexOf('\n', cut), s.lastIndexOf('\r', cut))
          if (obj >= s.length - 65536 && obj + 6 > pos) cut = obj + 6
          else if (nl >= s.length - 65536 && nl + 1 > pos) cut = nl + 1
          this.count(s.slice(pos, cut))
          this.pending = s.slice(cut)
          return
        }
        this.count(s.slice(pos, m.index))
        if (/\/Metadata(?![A-Za-z0-9])/.test(s.slice(Math.max(pos, m.index - 600), m.index)) && this.xmp === null) this.capture = ''
        this.inStream = true
        pos = m.index + m[0].length
      }
    }
  }

  end() {
    if (!this.inStream && this.pending) this.count(this.pending)
    this.pending = ''
  }

  count(raw) {
    if (!raw) return
    const s = decodeNames(raw)
    for (const [k, re] of Object.entries(FLAG_PATTERNS)) this.counts[k] += countMatches(re, s)
    if (s.includes('/Page')) this.pageObjects += countMatches(/\/Type\s*\/Page(?![A-Za-z0-9])/g, s)
    if (s.includes('/ObjStm')) this.objectStreams += countMatches(/\/Type\s*\/ObjStm(?![A-Za-z0-9])/g, s)
    if (s.includes('/Encrypt')) this.encryptRefs += countMatches(/\/Encrypt(?![A-Za-z0-9])\s*(?:<<|\d+\s+\d+\s+R)/g, s)
    if (s.includes('/Info')) for (const m of s.matchAll(/\/Info\s+(\d+)\s+(\d+)\s+R/g)) this.infoRefs.push(`${m[1]} ${m[2]}`)
    if (this.linearizedPages === null && s.includes('/Linearized')) {
      const m = /\/Linearized[\s\S]{0,300}?\/N\s+(\d+)/.exec(s)
      if (m) this.linearizedPages = Number(m[1])
    }
    if (s.includes('/Pages')) {
      for (const m of s.matchAll(/\/Type\s*\/Pages(?![A-Za-z0-9])/g)) {
        const from = s.lastIndexOf('endobj', m.index)
        const to = s.indexOf('endobj', m.index)
        if (from === -1 || to === -1 || to - from > 8192) continue
        const body = s.slice(from, to)
        if (/\/Parent(?![A-Za-z0-9])/.test(body)) continue
        const c = /\/Count\s+(\d{1,7})(?!\d)/.exec(body)
        if (c) this.pagesRoots.push(Number(c[1]))
      }
    }
    if (s.includes('/OpenAction')) {
      for (const m of s.matchAll(OPEN_ACTION)) {
        if (m[1] === '[') continue
        if (m[2]) this.openRefs.push(m[2])
        else if (m[1] === '<<' && /^[^>]{0,200}\/S\s*\/GoTo(?![A-Za-z0-9])/.test(s.slice(m.index + m[0].length, m.index + m[0].length + 220))) continue
        else this.counts.open_action++
      }
    }
    if (s.includes('/GoTo')) {
      for (const m of s.matchAll(/\/S\s*\/GoTo(?![A-Za-z0-9])/g)) {
        const obj = this.objectAround(s, m.index)
        if (obj && this.gotoObjects.size < 100_000) this.gotoObjects.add(obj.id.split(' ')[0])
      }
    }
    if (INFO_KEYS.test(s)) {
      let lastEnd = -1
      for (const k of s.matchAll(INFO_KEYS_G)) {
        if (k.index < lastEnd) continue
        const obj = this.objectAround(s, k.index)
        if (!obj) continue
        lastEnd = obj.end
        if (/^\s*<</.test(obj.body) && (this.objects.size < MAX_INFO_OBJECTS || this.objects.has(obj.id))) this.objects.set(obj.id, obj.body)
      }
    }
  }

  /** The "N G obj ... endobj" object that contains position i of s, when it is small enough to be a dictionary. */
  objectAround(s, i) {
    const lo = Math.max(0, s.lastIndexOf('endobj', i))
    const hi = s.indexOf('endobj', i)
    if (hi === -1 || hi - lo > MAX_OBJECT) return null
    const m = OBJ_HEAD.exec(s.slice(lo, hi))
    return m ? { id: `${m[1]} ${m[2]}`, body: m[3], end: hi } : null
  }
}

function mergeScanners(list) {
  const out = new Scanner()
  for (const sc of list) {
    for (const k of Object.keys(out.counts)) out.counts[k] += sc.counts[k]
    out.openRefs.push(...sc.openRefs)
    for (const g of sc.gotoObjects) out.gotoObjects.add(g)
    out.pageObjects += sc.pageObjects
    out.objectStreams += sc.objectStreams
    out.encryptRefs += sc.encryptRefs
    out.pagesRoots.push(...sc.pagesRoots)
    out.infoRefs.push(...sc.infoRefs)
    out.linearizedPages ??= sc.linearizedPages
    for (const [k, v] of sc.objects) out.objects.set(k, v)
    out.xmp ??= sc.xmp
  }
  return out
}

// ---- PDF text strings ----------------------------------------------------------------------------------------------------------------
const PDFDOC_HIGH = { 0x80: 0x2022, 0x81: 0x2020, 0x82: 0x2021, 0x83: 0x2026, 0x84: 0x2014, 0x85: 0x2013, 0x86: 0x0192, 0x87: 0x2044, 0x88: 0x2039, 0x89: 0x203a, 0x8a: 0x2212, 0x8b: 0x2030, 0x8c: 0x201e, 0x8d: 0x201c, 0x8e: 0x201d, 0x8f: 0x2018, 0x90: 0x2019, 0x91: 0x201a, 0x92: 0x2122, 0x93: 0xfb01, 0x94: 0xfb02, 0x95: 0x0141, 0x96: 0x0152, 0x97: 0x0160, 0x98: 0x0178, 0x99: 0x017d, 0x9a: 0x0131, 0x9b: 0x0142, 0x9c: 0x0153, 0x9d: 0x0161, 0x9e: 0x017e, 0xa0: 0x20ac }
const PDFDOC_LOW = { 0x18: 0x02d8, 0x19: 0x02c7, 0x1a: 0x02c6, 0x1b: 0x02d9, 0x1c: 0x02dd, 0x1d: 0x02db, 0x1e: 0x02da, 0x1f: 0x02dc }

function decodeUtf16(buf, bigEndian) {
  const even = buf.subarray(0, buf.length - (buf.length % 2))
  const swapped = bigEndian ? Buffer.from(even).swap16() : even
  return swapped.toString('utf16le')
}

const isStrictUtf8 = (buf) => { try { new TextDecoder('utf-8', { fatal: true }).decode(buf); return true } catch { return false } }

/** PDF "text string" bytes -> JS string: UTF-16BE/LE BOM, UTF-8 BOM, PDFDocEncoding; sloppy writers that store raw UTF-8 are accepted when it is valid UTF-8. */
export function decodePdfTextString(bytes) {
  const buf = Buffer.from(bytes)
  let text
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) text = decodeUtf16(buf.subarray(2), true)
  else if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) text = decodeUtf16(buf.subarray(2), false)
  else if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) text = buf.subarray(3).toString('utf8')
  else if (buf.some((b) => b >= 0x80) && isStrictUtf8(buf)) text = buf.toString('utf8')
  else text = Array.from(buf, (b) => (b < 0x18 ? (b === 9 || b === 10 || b === 13 ? ' ' : '') : String.fromCodePoint(PDFDOC_LOW[b] ?? PDFDOC_HIGH[b] ?? b))).join('')
  // eslint-disable-next-line no-control-regex -- strips NULs, controls and UTF-16 language escapes from metadata
  return text.replace(/\u001b[a-z]{2}(?:[A-Z]{2})?\u001b/g, '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim()
}

/** Reads the string token at s[i] ('(' literal or '<' hex) -> raw bytes, or null. */
function readStringToken(s, i) {
  if (s[i] === '(') {
    const out = []
    let depth = 0
    for (let p = i; p < s.length && p - i < MAX_STRING; p++) {
      const c = s[p]
      if (c === '\\') {
        const n = s[++p]
        if (n === undefined) break
        if (n >= '0' && n <= '7') {
          let oct = n
          while (oct.length < 3 && s[p + 1] >= '0' && s[p + 1] <= '7') oct += s[++p]
          out.push(parseInt(oct, 8) & 0xff)
        } else if (n === '\r') { if (s[p + 1] === '\n') p++ } else if (n !== '\n') out.push({ n: 10, r: 13, t: 9, b: 8, f: 12 }[n] ?? n.charCodeAt(0) & 0xff)
        continue
      }
      if (c === '(') { depth++; if (depth === 1) continue } else if (c === ')') { depth--; if (depth === 0) return Buffer.from(out) }
      out.push(c.charCodeAt(0) & 0xff)
    }
    return null
  }
  if (s[i] === '<' && s[i + 1] !== '<') {
    const end = s.indexOf('>', i)
    if (end === -1 || end - i > MAX_STRING) return null
    let hex = s.slice(i + 1, end).replace(/\s+/g, '')
    if (/[^0-9A-Fa-f]/.test(hex)) return null
    if (hex.length % 2) hex += '0'
    return Buffer.from(hex, 'hex')
  }
  return null
}

function readKey(body, key) {
  const m = new RegExp(`/${key}(?![A-Za-z0-9])\\s*`).exec(body)
  if (!m) return null
  const raw = readStringToken(body, m.index + m[0].length)
  return raw ? decodePdfTextString(raw) : null
}

/** "D:20230704153012+03'00'" -> "2023-07-04T15:30:12" (local time as written, no zone guessing) or null. */
export function parsePdfDate(raw) {
  const m = /^(?:D:)?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?/.exec(String(raw ?? '').trim())
  if (!m) return null
  const [y, mo = '01', d = '01', h = '00', mi = '00', se = '00'] = m.slice(1)
  if (+mo < 1 || +mo > 12 || +d < 1 || +d > 31 || +h > 23 || +mi > 59 || +se > 59 || +y < 1980) return null
  return `${y}-${mo}-${d}T${h}:${mi}:${se}`
}

function parseInfo(body) {
  return {
    title: readKey(body, 'Title'), author: readKey(body, 'Author'), subject: readKey(body, 'Subject'),
    creator: readKey(body, 'Creator'), producer: readKey(body, 'Producer'), creation_date_raw: readKey(body, 'CreationDate'),
  }
}

const xmlText = (s) => Buffer.from(s, 'latin1').toString('utf8')
  .replace(/<[^>]+>/g, '').replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()

export function parseXmp(packet) {
  if (!packet || !packet.includes('<')) return { title: null, creator: null, created: null }
  const alt = (tag) => {
    const block = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(packet)?.[1]
    if (!block) return null
    const items = [...block.matchAll(/<rdf:li([^>]*)>([\s\S]*?)<\/rdf:li>/g)]
    const pick = items.find((i) => /x-default/.test(i[1])) ?? items[0]
    return pick ? xmlText(pick[2]) || null : null
  }
  const created = /<xmp:CreateDate>([^<]+)</.exec(packet)?.[1] ?? /xmp:CreateDate="([^"]+)"/.exec(packet)?.[1] ?? null
  return { title: alt('dc:title'), creator: alt('dc:creator'), created: created ? parsePdfDate(created.replace(/[-:T]/g, '')) : null }
}

// ---- title quality ---------------------------------------------------------------------------------------------------------------------
const ARTEFACT_EXACT = new Set(['untitled', 'document', 'new document', 'document1', 'presentation', 'presentation1', 'book1', 'microsoft word', 'microsoft powerpoint', 'microsoft excel', 'adobe acrobat', 'acrobat', 'pdf', 'scan', 'scanned', 'scanned document', 'print', 'image', 'page 1', 'layout1', 'temp', 'tmp', 'test', 'indesign', 'adobe indesign', 'libreoffice', 'writer', 'word', 'بدون عنوان', 'مستند', 'مستند جديد', 'عنوان', 'بلا عنوان'])
const FILE_EXT = /\.(?:docx?|dotx?|indd|idml|pdf|pptx?|xlsx?|rtf|txt|tmp|qxd|psd|ai|odt|wps|pub|xps|jpe?g|png|tiff?|cdr|html?|php|zip|rar)(?:\s|$)/i
const WORD_LIKE = /(?=\p{L})[\p{Script=Arabic}\p{Script=Latin}]/gu // letters only: Arabic-Indic digits belong to the Arabic script

/** A title "clearly establishes identity" only if it is a real, human-written name rather than a software or filename artefact. */
export function classifyTitle(title) {
  const reasons = []
  const t = typeof title === 'string' ? title.replace(/\s+/g, ' ').trim() : ''
  if (!t) return { clear: false, reasons: ['empty'] }
  const lower = t.toLowerCase()
  if (looksMojibake(t) || /[\u0080-\u009f�]/.test(t)) reasons.push('damaged_encoding')
  if (ARTEFACT_EXACT.has(lower) || /^(?:untitled|document\d+|presentation\d+|book\d+|new document)\b/i.test(t)) reasons.push('software_default')
  if (/^microsoft[®\s]*(?:word|powerpoint|excel|publisher)\b/i.test(t) || /\b(?:adobe\s+(?:indesign|acrobat|illustrator|photoshop)|acrobat distiller|pdfmaker|libreoffice|openoffice|wps\s+office)\b/i.test(t)) reasons.push('software_artefact')
  if (FILE_EXT.test(t)) reasons.push('filename_extension')
  if (/^~\$|^tmp[\s_-]?\w*$|^temp[\s_-]?\d*$/i.test(t)) reasons.push('temp_name')
  if (/[\\/]/.test(t) && /(?:^[a-z]:[\\/]|^[\\/]|\.\w{2,4}$)/i.test(t)) reasons.push('path')
  if (/[-_ ]\d{8,}$/.test(t)) reasons.push('timestamp_suffix')
  if (/^[\d\s\p{P}\p{S}]+$/u.test(t)) reasons.push('digits_or_symbols_only')
  const letters = t.match(WORD_LIKE)?.length ?? 0
  if (letters < 3) reasons.push('fewer_than_3_letters')
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t) || /^[0-9a-f]{16,}$/i.test(t)) reasons.push('hash_like')
  else if (/^[A-Za-z0-9_-]{12,}$/.test(t) && /\d/.test(t) && /[A-Za-z]/.test(t) && (/[a-z]/.test(t) && /[A-Z]/.test(t) || t.length >= 16)) reasons.push('hash_like')
  return { clear: reasons.length === 0, reasons }
}

// ---- analysis --------------------------------------------------------------------------------------------------------------------------
const SUSPICIOUS_FLAGS = ['javascript', 'js', 'launch', 'open_action', 'embedded_file', 'aa', 'uri']

function finish({ scanner, size, sha256, head, mode, scannedBytes }) {
  const header = head.subarray(0, 1024).toString('latin1')
  const at = header.indexOf('%PDF-')
  if (at === -1) return { ok: false, reason: 'no_pdf_header', size }
  if (at !== 0) return { ok: false, reason: 'pdf_header_not_at_start', size }
  const version = /^%PDF-(\d\.\d)/.exec(header)?.[1] ?? null
  scanner.end()

  const encrypted = scanner.encryptRefs > 0
  const flags = { ...scanner.counts }
  flags.open_action += scanner.openRefs.filter((n) => !scanner.gotoObjects.has(n)).length // a target we cannot see (compressed) stays counted
  const suspiciousReasons = SUSPICIOUS_FLAGS.filter((k) => flags[k] > 0)

  const ref = scanner.infoRefs.at(-1) ?? null
  let infoBody = ref ? scanner.objects.get(ref) ?? null : null
  let infoSource = infoBody ? 'trailer_reference' : null
  if (!infoBody && !ref) {
    const guess = [...scanner.objects.values()].reverse().find((b) => /\/(?:Producer|Creator|CreationDate)\s*[(<]/.test(b))
    if (guess) { infoBody = guess; infoSource = 'heuristic' }
  }
  const info = infoBody ? parseInfo(infoBody) : { title: null, author: null, subject: null, creator: null, producer: null, creation_date_raw: null }
  const xmp = parseXmp(scanner.xmp)
  const created = parsePdfDate(info.creation_date_raw) ?? xmp.created

  let pages = null
  if (scanner.pagesRoots.length) pages = { estimate: Math.min(scanner.pagesRoots.at(-1), MAX_PAGES), source: 'pages_root_count' }
  else if (scanner.linearizedPages) pages = { estimate: Math.min(scanner.linearizedPages, MAX_PAGES), source: 'linearized' }
  else if (scanner.pageObjects) pages = { estimate: Math.min(scanner.pageObjects, MAX_PAGES), source: 'page_objects', partial: mode === 'edges' }

  // encrypted strings cannot be decoded without the key: never present them as a title
  const candidates = encrypted ? [] : [['info', info.title], ['xmp', xmp.title]].filter(([, t]) => t)
  const good = candidates.find(([, t]) => classifyTitle(t).clear)
  const [titleSource, title] = good ?? candidates[0] ?? [null, null]
  return {
    ok: true, size, sha256, version, encrypted,
    pages, info, xmp, created,
    info_located: Boolean(infoBody), info_reference_found: Boolean(ref), info_source: infoSource,
    flags, suspicious: suspiciousReasons.length > 0, suspicious_reasons: suspiciousReasons,
    object_streams: scanner.objectStreams, // > 0: part of the structure is compressed and cannot be inspected without decoding it
    title, title_source: titleSource, title_quality: classifyTitle(title),
    scan: { mode, bytes: scannedBytes },
  }
}

/** Analyse PDF bytes held in memory (tests, small inputs). Never throws. */
export function analyzePdfBytes(bytes) {
  try {
    const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes ?? [])
    if (buf.length < 8) return { ok: false, reason: 'too_small', size: buf.length }
    if (buf.subarray(0, 1024).toString('latin1').indexOf('%PDF-') !== 0) return finish({ scanner: new Scanner(), size: buf.length, sha256: null, head: buf, mode: 'whole', scannedBytes: 0 })
    const scanner = new Scanner()
    for (let o = 0; o < buf.length; o += WINDOW) scanner.push(buf.subarray(o, o + WINDOW))
    return finish({ scanner, size: buf.length, sha256: createHash('sha256').update(buf).digest('hex'), head: buf, mode: 'whole', scannedBytes: buf.length })
  } catch (e) {
    return { ok: false, reason: 'analysis_error', detail: String(e?.name ?? 'Error') }
  }
}

/**
 * Analyse a PDF on disk with bounded memory. mode 'full' streams the whole file (SHA-256 + keyword scan); 'edges' reads only the first and
 * last 1 MiB (no hash). Default: full up to FULL_SCAN_LIMIT, edges above it. Never throws.
 */
export async function analyzePdfFile(file, { mode, fullScanLimit = FULL_SCAN_LIMIT } = {}) {
  let fh
  try {
    fh = await open(file, 'r')
    const { size } = await fh.stat()
    const chosen = mode ?? (size <= fullScanLimit ? 'full' : 'edges')
    const readAt = async (position, length) => {
      const buf = Buffer.allocUnsafe(length)
      const { bytesRead } = await fh.read(buf, 0, length, position)
      return buf.subarray(0, bytesRead)
    }
    const head = await readAt(0, Math.min(WINDOW, size))
    if (head.length < 8) return { ok: false, reason: 'too_small', size }
    if (head.subarray(0, 1024).toString('latin1').indexOf('%PDF-') !== 0) return finish({ scanner: new Scanner(), size, sha256: null, head, mode: chosen, scannedBytes: 0 })

    if (chosen === 'full' || size <= 2 * WINDOW) {
      const hash = createHash('sha256')
      const scanner = new Scanner()
      let position = 0
      while (position < size) {
        const chunk = position === 0 ? head : await readAt(position, Math.min(WINDOW, size - position))
        if (!chunk.length) break
        hash.update(chunk)
        scanner.push(chunk)
        position += chunk.length
      }
      return finish({ scanner, size, sha256: hash.digest('hex'), head, mode: size <= 2 * WINDOW ? 'whole' : 'full', scannedBytes: position })
    }
    const tail = await readAt(size - WINDOW, WINDOW)
    const a = new Scanner(); a.push(head)
    const b = new Scanner({ inStream: true }); b.push(tail) // the tail window usually starts inside a stream body
    a.end(); b.end()
    return finish({ scanner: mergeScanners([a, b]), size, sha256: null, head, mode: 'edges', scannedBytes: head.length + tail.length })
  } catch (e) {
    return { ok: false, reason: e?.code === 'ENOENT' ? 'file_missing' : 'read_error', detail: String(e?.code ?? e?.name ?? 'Error') }
  } finally { await fh?.close().catch(() => {}) }
}
