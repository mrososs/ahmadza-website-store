// Independent validation of RECOVERED legacy catalogue tables, run BEFORE anything is imported. It deliberately does not use the importer's mappers:
// it asks "is this data plausible and internally consistent?", not "can the importer read it?". Pure functions over rows, so they can be tested with
// fixtures and run against the isolated recovered MariaDB through the same source abstraction the importer uses.
// Output is counts and legacy ids only. No titles, names, e-mail addresses or any other row content ever leave this module.
import path from 'node:path'

export const REQUIRED_TABLES = ['categories', 'makers', 'books', 'book_media']
export const OPTIONAL_TABLES = ['related_books']
export const REQUIRED_COLUMNS = {
  categories: ['id', 'name', 'status'],
  makers: ['id', 'name', 'type', 'status'],
  books: ['id', 'name', 'type', 'cost', 'status'],
  book_media: ['id', 'book_id', 'file', 'external'],
  related_books: ['book_id', 'related_id'],
}
export const SAMPLE = 20

const ARABIC = /[؀-ۿ]/
const ARABIC_DIGITS = { '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9', '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9' }

/** UTF-8 Arabic decoded as Latin-1/cp1252 ("Ø§Ù„…"), replacement characters, or text flattened to question marks. */
export function looksMojibake(s) {
  if (typeof s !== 'string' || !s) return false
  if (s.includes('�')) return true
  if (/\?{3,}/.test(s) && !ARABIC.test(s)) return true
  return !ARABIC.test(s) && (s.match(/[ØÙÃ][\u0080-¿ŒœŠšŸŽžˆ˜–-›]/g) ?? []).length >= 2
}

/** 'ok' | 'missing' | 'unparsable' | 'non_positive' — a plausibility check on the raw price, not a conversion. */
export function priceState(raw) {
  if (raw == null || String(raw).trim() === '') return 'missing'
  const t = String(raw).trim().replace(/[٠-٩۰-۹]/g, (d) => ARABIC_DIGITS[d]).replace(/[٫]/g, '.').replace(/[٬،]/g, ',')
  const plain = /^\d{1,3}(,\d{3})+(\.\d+)?$/.test(t) ? t.replace(/,/g, '') : t
  if (!/^\d+(\.\d+)?$/.test(plain)) return 'unparsable'
  return Number(plain) > 0 ? 'ok' : 'non_positive'
}

const isId = (v) => (typeof v === 'number' || (typeof v === 'string' && /^\d+$/.test(v))) && Number.isInteger(Number(v)) && Number(v) > 0
const num = (v) => Number(v)

function finding(code, message, ids = []) {
  return { code, message, count: ids.length, sample_ids: ids.slice(0, SAMPLE) }
}

/**
 * @param {{ tables: Record<string, object[]|undefined>, expected?: { books?: number, book_media?: number, categories?: number, makers?: number }, inventoryNames?: string[]|null, now?: Date }} input
 */
export function validateCatalog({ tables, expected = {}, inventoryNames = null, now = new Date() }) {
  const errors = [], warnings = [], info = []
  const E = (code, message, ids) => errors.push(finding(code, message, ids ?? [0]))
  const W = (code, message, ids) => { if (!ids || ids.length) warnings.push(finding(code, message, ids ?? [0])) }
  const counts = Object.fromEntries([...REQUIRED_TABLES, ...OPTIONAL_TABLES].map((t) => [t, tables[t]?.length ?? null]))

  // ---- 1. presence, columns, counts -------------------------------------------------------------------------------------------------------------
  for (const t of REQUIRED_TABLES) {
    if (!tables[t]) E('table_missing', `required table ${t} is not present in the recovered database`)
    else if (!tables[t].length) (t === 'books' ? E : W)('table_empty', `table ${t} is empty`)
  }
  if (!tables.related_books) W('optional_table_missing', 'related_books is absent (related-book links will simply not be created)')
  for (const [t, cols] of Object.entries(REQUIRED_COLUMNS)) {
    const first = tables[t]?.[0]
    if (!first) continue
    const missing = cols.filter((c) => !(c in first))
    if (missing.length) E('column_missing', `table ${t} lacks required column(s): ${missing.join(', ')}`)
  }
  for (const [t, n] of Object.entries(expected)) {
    if (n != null && counts[t] != null && counts[t] !== n) W('count_differs_from_expected', `${t}: ${counts[t]} rows recovered, ${n} expected`)
  }

  const books = tables.books ?? [], media = tables.book_media ?? [], cats = tables.categories ?? [], makers = tables.makers ?? [], related = tables.related_books ?? []

  // ---- 2. primary keys --------------------------------------------------------------------------------------------------------------------------
  for (const [t, rows] of [['categories', cats], ['makers', makers], ['books', books], ['book_media', media]]) {
    const bad = rows.filter((r) => !isId(r.id)).map((r) => String(r.id))
    if (bad.length) E('pk_invalid', `${t}: id must be a positive integer`, bad)
    const seen = new Set(), dup = new Set()
    for (const r of rows) { const k = String(r.id); if (seen.has(k)) dup.add(k); seen.add(k) }
    if (dup.size) E('pk_duplicate', `${t}: duplicate primary keys`, [...dup])
  }
  const bookIds = new Set(books.map((r) => String(r.id))), catIds = new Set(cats.map((r) => String(r.id))), makerIds = new Set(makers.map((r) => String(r.id)))

  // ---- 3. referential integrity -----------------------------------------------------------------------------------------------------------------
  const orphanMedia = media.filter((m) => !bookIds.has(String(m.book_id))).map((m) => m.id)
  if (orphanMedia.length) (media.length && orphanMedia.length / media.length > 0.25 ? E : W)('media_orphan_book', 'book_media rows whose book_id does not exist in books', orphanMedia)
  const badMakers = []
  for (const b of books) for (const c of ['author_id', 'reader_id', 'writer_id']) if (b[c] != null && b[c] !== '' && !makerIds.has(String(b[c]))) badMakers.push(b.id)
  W('book_unknown_maker', 'books referencing a maker id that does not exist', [...new Set(badMakers)])
  const badCats = [], badCatJson = []
  for (const b of books) {
    if (b.category == null || b.category === '') continue
    try {
      const v = JSON.parse(b.category)
      if (!Array.isArray(v)) { badCatJson.push(b.id); continue }
      if (v.some((c) => !catIds.has(String(c)))) badCats.push(b.id)
    } catch { badCatJson.push(b.id) }
  }
  W('book_category_json_invalid', 'books whose category column is not a JSON array', badCatJson)
  W('book_unknown_category', 'books pointing at a category id that does not exist', badCats)
  W('related_unknown_book', 'related_books rows pointing at a book that does not exist', related.filter((r) => !bookIds.has(String(r.book_id)) || !bookIds.has(String(r.related_id))).map((r) => `${r.book_id}->${r.related_id}`))

  // ---- 4. domain checks ---------------------------------------------------------------------------------------------------------------------------
  const unknownType = books.filter((b) => b.type !== 'free' && b.type !== 'paid').map((b) => b.id)
  if (unknownType.length) (books.length && unknownType.length / books.length > 0.5 ? E : W)('book_unknown_type', 'books whose type is neither free nor paid (cannot be imported)', unknownType)
  const unknownStatus = books.filter((b) => ![0, 1, 2].includes(num(b.status))).map((b) => b.id)
  if (unknownStatus.length) (books.length && unknownStatus.length / books.length > 0.5 ? E : W)('book_unknown_status', 'books whose status is outside 0/1/2 (will stay drafts, status kept raw)', unknownStatus)
  const price = { missing: [], unparsable: [], non_positive: [] }
  for (const b of books) if (b.type === 'paid') { const s = priceState(b.cost); if (s !== 'ok') price[s].push(b.id) }
  W('paid_price_missing', 'paid books without a price (will stay drafts)', price.missing)
  W('paid_price_unparsable', 'paid books whose price cannot be read as a number (will stay drafts, raw string kept)', price.unparsable)
  W('paid_price_non_positive', 'paid books with a price of zero or less (will stay drafts)', price.non_positive)
  W('book_empty_title', 'books with an empty title (cannot be imported)', books.filter((b) => !String(b.name ?? '').trim()).map((b) => b.id))
  W('category_empty_name', 'categories with an empty name', cats.filter((c) => !String(c.name ?? '').trim()).map((c) => c.id))
  W('maker_unknown_type', 'makers whose type is not author/reader/writer', makers.filter((m) => !['author', 'reader', 'writer'].includes(m.type)).map((m) => m.id))
  const badExternal = media.filter((m) => Number(m.external) === 1 && !/^https?:\/\//i.test(String(m.file ?? ''))).map((m) => m.id)
  W('media_external_not_url', 'external media rows whose file is not an http(s) URL', badExternal)
  const badPath = media.filter((m) => Number(m.external) !== 1 && (!m.file || /(^|[\\/])\.\.([\\/]|$)/.test(String(m.file)) || path.isAbsolute(String(m.file)) || /^[a-z]:/i.test(String(m.file)))).map((m) => m.id)
  W('media_path_unsafe', 'internal media rows with an empty, absolute or parent-traversing path (will not be linked)', badPath)

  // ---- 5. text integrity (character set damage) -------------------------------------------------------------------------------------------------
  const textRows = [...books.map((b) => ['books', b.id, b.name]), ...cats.map((c) => ['categories', c.id, c.name]), ...makers.map((m) => ['makers', m.id, m.name])]
  const garbled = textRows.filter(([, , s]) => looksMojibake(s))
  if (garbled.length) (garbled.length / textRows.length > 0.1 ? E : W)('text_mojibake', 'names that look like damaged character encoding (e.g. "Ø§Ù„…" or "????")', garbled.map(([t, id]) => `${t}:${id}`))
  const arabicShare = textRows.length ? textRows.filter(([, , s]) => ARABIC.test(String(s ?? ''))).length / textRows.length : 0
  info.push({ code: 'arabic_text_share', message: 'share of names containing Arabic letters', value: Number(arabicShare.toFixed(3)) })

  // ---- 6. dates -------------------------------------------------------------------------------------------------------------------------------------
  const zeroDates = [], futureDates = [], oldDates = []
  for (const b of books) {
    const v = b.created_at
    if (v == null || v === '') continue
    const s = String(v)
    if (s.startsWith('0000-00-00')) { zeroDates.push(b.id); continue }
    const d = new Date(s.replace(' ', 'T') + (s.includes('T') || s.endsWith('Z') ? '' : 'Z'))
    if (Number.isNaN(d.getTime())) zeroDates.push(b.id)
    else if (d.getTime() > now.getTime() + 86_400_000) futureDates.push(b.id)
    else if (d.getUTCFullYear() < 2012) oldDates.push(b.id)
  }
  W('book_zero_or_invalid_date', 'books with a zero or unreadable created_at', zeroDates)
  W('book_future_date', 'books created in the future', futureDates)
  W('book_implausibly_old_date', 'books created before 2012', oldDates)

  // ---- 7. duplicates and file matching (informational) ------------------------------------------------------------------------------------------
  const titleCount = new Map()
  for (const b of books) { const k = String(b.name ?? '').trim().toLowerCase(); if (k) titleCount.set(k, (titleCount.get(k) ?? 0) + 1) }
  info.push({ code: 'duplicate_titles', message: 'distinct titles that appear more than once', value: [...titleCount.values()].filter((n) => n > 1).length })
  const pathCount = new Map()
  for (const m of media) if (Number(m.external) !== 1 && m.file) { const k = String(m.file); pathCount.set(k, (pathCount.get(k) ?? 0) + 1) }
  info.push({ code: 'media_paths_shared_by_several_rows', message: 'internal file paths referenced by more than one media row', value: [...pathCount.values()].filter((n) => n > 1).length })
  let fileMatch = null
  if (inventoryNames) {
    const names = new Set(inventoryNames.map((n) => path.basename(String(n)).toLowerCase()))
    const internal = media.filter((m) => Number(m.external) !== 1 && m.file)
    const matched = internal.filter((m) => names.has(path.basename(String(m.file)).toLowerCase()))
    const referenced = new Set(internal.map((m) => path.basename(String(m.file)).toLowerCase()))
    fileMatch = {
      internal_media_rows: internal.length, rows_with_a_file_in_the_inventory: matched.length, rows_without_a_file: internal.length - matched.length,
      inventory_files: names.size, inventory_files_not_referenced_by_any_media_row: [...names].filter((n) => !referenced.has(n)).length,
    }
    if (internal.length && matched.length === 0) W('media_no_file_matches', 'no internal media row matches any inventoried file: the table and the files are probably from different times or sources')
  }

  const verdict = errors.length ? 'fail' : warnings.length ? 'pass_with_warnings' : 'pass'
  return { verdict, counts, errors, warnings, info, file_match: fileMatch }
}

/** Human-readable summary, safe to paste into a report. */
export function renderValidation(r) {
  const lines = [`VALIDATION: ${r.verdict.toUpperCase()}`, `rows: ${Object.entries(r.counts).map(([t, n]) => `${t}=${n ?? 'absent'}`).join('  ')}`]
  for (const [label, list] of [['ERROR', r.errors], ['WARN', r.warnings]]) for (const f of list) lines.push(`${label}  ${f.code}: ${f.message}${f.count > 0 && f.sample_ids[0] !== 0 ? ` (${f.count}; e.g. ${f.sample_ids.slice(0, 5).join(', ')})` : ''}`)
  for (const i of r.info) lines.push(`info  ${i.code}: ${i.value}`)
  if (r.file_match) lines.push(`files ${JSON.stringify(r.file_match)}`)
  return lines.join('\n')
}
