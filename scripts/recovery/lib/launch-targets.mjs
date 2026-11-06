// Static review of PDF /Launch actions. READ-ONLY and DECISION-FREE: it reads bytes, never opens, renders or executes a file, and never admits anything.
// It exists so a human reviewer can see WHAT each flagged file would launch, grouped, instead of reading 445 files. A file flagged for /Launch stays excluded from
// ingestion whatever this reports; admitting any file is a separate, recorded owner decision (docs/implementation/SUSPICIOUS_PDF_POLICY.md).
import { open } from 'node:fs/promises'

// Targets that would run code or script on a viewer's machine when launched.
export const EXEC_EXT = new Set(['exe', 'com', 'bat', 'cmd', 'scr', 'pif', 'msi', 'msp', 'dll', 'js', 'jse', 'vbs', 'vbe', 'wsf', 'wsh', 'ps1', 'psm1', 'lnk', 'hta', 'jar', 'sh', 'bash', 'py', 'pl', 'php', 'reg', 'cpl', 'gadget', 'application', 'docm', 'xlsm', 'pptm', 'xlam', 'ppam'])
// Plain documents and media: opening one still hands a file to another program, but it does not run a script.
export const DOC_EXT = new Set(['pdf', 'doc', 'docx', 'rtf', 'txt', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'jpg', 'jpeg', 'png', 'gif', 'tif', 'tiff', 'bmp', 'webp', 'mp3', 'mp4', 'wav', 'epub'])

const LAUNCH = /\/Launch(?![A-Za-z0-9])/g
const OBJECT_HEAD = /(?<![0-9])(\d{1,10})\s+\d{1,5}\s+obj(?![A-Za-z])/g
const CHUNK = 1024 * 1024
const WINDOW = 600 // bytes read after each match: an action or file-specification dictionary is short
const BEFORE = 300 // bytes read before a match (must stay below OVERLAP, which is what carries them across a chunk boundary)
const OVERLAP = WINDOW + 16
const MAX_ACTIONS = 20

const decodeLiteral = (raw) => raw.slice(1, -1).replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_m, c) => ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' })[c] ?? String.fromCharCode(parseInt(c, 8)))
const decodeHex = (raw) => { const h = raw.slice(1, -1).replace(/\s+/g, ''); return Buffer.from(h.length % 2 ? `${h}0` : h, 'hex').toString('latin1') }
const pdfString = (raw) => (raw.startsWith('(') ? decodeLiteral(raw) : decodeHex(raw))
const STRING = String.raw`(\((?:[^()\\]|\\.)*\)|<[0-9A-Fa-f\s]*>)`
const untilEndObj = (text) => { const end = text.indexOf('endobj'); return end > 0 ? text.slice(0, end) : text }

/**
 * One /Launch occurrence: the text that follows it (a latin1 string) -> what it would launch. Never throws.
 * The target is either an inline string (/F (name)) or an indirect reference to a file specification (/F 12 0 R, then see parseFilespecWindow); `ref` is that object number.
 */
export function parseLaunchWindow(text) {
  const w = untilEndObj(text)
  const file = new RegExp(String.raw`\/F\s*${STRING}`).exec(w)
  const ref = /\/F\s+(\d{1,10})\s+\d{1,5}\s+R(?![A-Za-z])/.exec(w)
  return {
    target: file ? pdfString(file[1]).trim().slice(0, 300) : null,
    ref: !file && ref ? Number(ref[1]) : null,
    has_params: new RegExp(String.raw`\/P\s*${STRING}`).test(w), // command-line parameters passed to the launched program
    has_directory: new RegExp(String.raw`\/D\s*${STRING}`).test(w),
    platform_blocks: ['/Win', '/Mac', '/Unix'].filter((p) => w.includes(p)),
    new_window: /\/NewWindow\s+true/.test(w),
  }
}

/** The body of a file-specification object (what follows "N 0 obj"): its target name. A /FS /URL specification is a URL, whatever its text looks like. */
export function parseFilespecWindow(text) {
  const w = untilEndObj(text)
  const name = new RegExp(String.raw`\/F\s*${STRING}`).exec(w) ?? new RegExp(String.raw`\/UF\s*${STRING}`).exec(w)
  if (!name) return null
  const target = pdfString(name[1]).trim().slice(0, 300)
  return /\/FS\s*\/URL(?![A-Za-z])/.test(w) ? `url://${target}` : target
}

/** The class of a target string. Order matters: the most dangerous reading wins. */
export function classifyTarget(target) {
  if (target == null || target === '') return 'no_target'
  const t = target.replace(/\0/g, '')
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t) || /^(javascript|vbscript|data|mailto):/i.test(t)) return 'url_or_script'
  if (/^[\\/]{2}/.test(t) || /^[a-z]:[\\/]/i.test(t) || /^[\\/]/.test(t) || /^~/.test(t)) return 'absolute_or_network_path'
  if (/(^|[\\/])\.\.([\\/]|$)/.test(t)) return 'path_traversal'
  const ext = /\.([A-Za-z0-9]{1,8})$/.exec(t.trim())?.[1]?.toLowerCase()
  if (!ext) return 'no_extension'
  if (EXEC_EXT.has(ext)) return 'executable_or_script'
  if (DOC_EXT.has(ext)) return /[\\/]/.test(t) ? 'document_in_subfolder' : 'document_same_folder'
  return 'unknown_extension'
}

/**
 * File-level verdict from its Launch actions. 'reviewable' means ONLY that a human may look at it; it is never an approval.
 * 'blocked': at least one action could run code, reach outside the folder, carries parameters, or names a target that could not be read. 'inconclusive': a Launch keyword but no readable action.
 */
export function verdictFor(actions) {
  if (!actions.length) return 'inconclusive'
  const classes = actions.map((a) => classifyTarget(a.target))
  if (actions.some((a) => a.has_params || a.has_directory)) return 'blocked'
  if (classes.some((c) => ['url_or_script', 'absolute_or_network_path', 'path_traversal', 'executable_or_script', 'no_extension', 'unknown_extension', 'no_target'].includes(c))) return 'blocked'
  return 'reviewable' // every action points at a plain document next to the file (or below it), with no parameters
}

/**
 * Streams the file once, calling onMatch(match, followingText) for every regex match exactly once. Every position is ABSOLUTE (offset in the file), so a match that sits
 * in the overlap between two chunks is reported once, and a match whose following text is cut by a chunk end waits for the next chunk (which carries it).
 */
async function streamMatches(fh, size, regex, onMatch) {
  const chunk = Buffer.alloc(CHUNK)
  const found = new Set()
  let carry = ''
  let carryStart = 0 // absolute offset of carry[0]
  let offset = 0
  for (;;) {
    const { bytesRead } = await fh.read(chunk, 0, chunk.length, offset)
    if (!bytesRead) break
    offset += bytesRead
    const last = offset >= size
    const text = carry + chunk.subarray(0, bytesRead).toString('latin1')
    regex.lastIndex = 0
    let m
    while ((m = regex.exec(text))) {
      const abs = carryStart + m.index
      if (found.has(abs)) continue
      if (!last && m.index + m[0].length + WINDOW > text.length) break // its window continues in the next chunk; it is inside the carried overlap, so it is found there
      found.add(abs)
      // `before` is the text back to the previous object end: PDF dictionary keys come in any order, so /F may precede /S /Launch
      const back = text.slice(Math.max(0, m.index - BEFORE), m.index)
      const objectEnd = back.lastIndexOf('endobj')
      onMatch(m, text.slice(m.index + m[0].length, m.index + m[0].length + WINDOW), objectEnd === -1 ? back : back.slice(objectEnd + 6))
    }
    carry = text.slice(-OVERLAP)
    carryStart += text.length - carry.length
  }
  return found.size
}

/**
 * Returns every Launch action found (at most 20 are read), the number of /Launch keywords, and for an action whose target is an indirect file specification the name that
 * object gives (`via_ref`). A reference that cannot be found (for example inside a compressed object stream) stays without a target, which is never reviewable.
 * Refuses huge files.
 */
export async function scanFileForLaunch(file, { maxBytes = 512 * 1024 * 1024 } = {}) {
  let fh
  try {
    fh = await open(file, 'r')
    const { size } = await fh.stat()
    if (size > maxBytes) return { ok: false, reason: 'too_large', size }
    const actions = []
    const launch_keywords = await streamMatches(fh, size, LAUNCH, (_m, after, before) => { if (actions.length < MAX_ACTIONS) actions.push(parseLaunchWindow(`${before}/Launch${after}`)) })
    const wanted = new Set(actions.filter((a) => a.target == null && a.ref != null).map((a) => a.ref))
    if (wanted.size) {
      const specs = new Map() // a later definition (an incremental update) replaces an earlier one
      await streamMatches(fh, size, OBJECT_HEAD, (m, after) => { if (wanted.has(Number(m[1]))) specs.set(Number(m[1]), parseFilespecWindow(after)) })
      for (const a of actions) if (a.target == null && a.ref != null && specs.get(a.ref)) { a.target = specs.get(a.ref); a.via_ref = true }
    }
    return { ok: true, size, launch_keywords, actions }
  } catch (e) { return { ok: false, reason: `unreadable:${e.code ?? 'error'}` } } finally { await fh?.close() }
}
