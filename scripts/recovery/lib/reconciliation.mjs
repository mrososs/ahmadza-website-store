// Pure reconciliation of the recovered media against the (missing) catalogue. No I/O: the CLI feeds it the inventory, the PDF evidence,
// the staging rows and the link counts. It only ever states what the inputs prove; absence of a database is reported as zero, not hidden.
const count = (list, key) => list.reduce((m, x) => { const k = typeof key === 'function' ? key(x) : x[key]; m[k] = (m[k] ?? 0) + 1; return m }, {})
const sorted = (o) => Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
export const short = (sha) => String(sha ?? '').slice(0, 12)

const EDITOR_CLASS = { png: 'image', jpeg: 'image', gif: 'image', webp: 'image', bmp: 'image', svg: 'vector/active', mvg: 'vector/active', mp4: 'video', php: 'script', text: 'text/other' }

/** Classifies one PDF row from its evidence. */
export function classifyPdf(ev) {
  const a = ev?.analysis
  if (!a) return { state: 'not_analysed', title: null }
  if (!a.ok) return { state: a.reason === 'no_pdf_header' || a.reason === 'pdf_header_not_at_start' ? 'wrong_magic' : 'unreadable', reason: a.reason, title: null }
  if (ev.problems?.length) return { state: 'integrity_mismatch', reason: ev.problems.join(','), title: null }
  if (a.suspicious) return { state: 'suspicious', reason: a.suspicious_reasons.join(','), title: null, titled: Boolean(a.title_quality?.clear) }
  if (a.encrypted) return { state: 'encrypted', title: null }
  if (a.title_quality?.clear) return { state: 'clear_title', title: a.title }
  return { state: 'no_clear_title', reason: (a.title_quality?.reasons ?? []).join(','), title: null }
}

/**
 * @param {object} p
 * @param {object[]} p.inventory inventory.json rows
 * @param {Map<string, { analysis: object, problems: string[] }>} p.evidence PDF evidence by inventory path
 * @param {object[] | null} p.staging legacy_media_staging rows, null when the table could not be read
 * @param {{ verified_links: number | null, recovered_media_drafts: number | null, checked: boolean }} p.links
 */
export function buildReconciliation({ inventory, evidence, staging, links, generatedAt = new Date().toISOString(), mode = 'full' }) {
  const product = inventory.filter((r) => r.scope === 'product')
  const pdfs = product.filter((r) => r.detected_type === 'pdf' && r.accepted)
  const other = product.filter((r) => !(r.detected_type === 'pdf' && r.accepted))
  const editor = inventory.filter((r) => r.scope === 'editor')
  const stagingByPath = new Map((staging ?? []).map((s) => [s.legacy_path, s]))

  // ---- per-PDF state, then distinct blobs --------------------------------------------------------------------------------------------
  const rows = pdfs.map((r) => ({ row: r, cls: classifyPdf(evidence.get(r.path)), ev: evidence.get(r.path)?.analysis, st: stagingByPath.get(r.path) }))
  const byState = count(rows, (x) => x.cls.state)
  const bySha = new Map()
  for (const x of rows) bySha.set(x.row.sha256, [...(bySha.get(x.row.sha256) ?? []), x])
  const blobs = [...bySha.entries()].map(([sha, list]) => {
    list.sort((a, b) => a.row.path.localeCompare(b.row.path))
    const head = list.find((x) => x.cls.state === 'clear_title') ?? list[0]
    const staged = list.find((x) => x.st && ['staged', 'linked'].includes(x.st.status) && !x.st.duplicate_of) ?? list.find((x) => x.st && ['staged', 'linked'].includes(x.st.status))
    return { sha256: sha, size: head.row.size, files: list.length, state: head.cls.state, reason: head.cls.reason ?? null, head, list, staged: staged?.st ?? null }
  })
  const clear = blobs.filter((b) => b.state === 'clear_title')
  const suspicious = blobs.filter((b) => b.state === 'suspicious')
  const dupGroups = blobs.filter((b) => b.files > 1)
  const titleGroups = Object.entries(count(clear, (b) => b.head.cls.title)).filter(([, n]) => n > 1)

  const candidates = clear.map((b) => ({
    sha256: b.sha256, size: b.size, legacy_path: (b.list.find((x) => b.staged && x.st?.id === b.staged.id) ?? b.list[0]).row.path,
    title: b.head.cls.title, title_source: b.head.ev.title_source, author: b.head.ev.info?.author ?? b.head.ev.xmp?.creator ?? null,
    pages_estimate: b.head.ev.pages?.estimate ?? null, created: b.head.ev.created ?? null,
    files: b.files, staging_id: b.staged?.id ?? null, staging_status: b.staged?.status ?? (staging ? 'inventoried' : 'unknown'),
  })).sort((x, y) => x.sha256.localeCompare(y.sha256))

  const stagingStatus = staging ? count(staging.filter((s) => s.scope === 'product'), 'status') : null
  const flagTotals = {}
  for (const x of rows) for (const k of x.ev?.suspicious_reasons ?? []) flagTotals[k] = (flagTotals[k] ?? 0) + 1
  const suspiciousByFlagSet = count(rows.filter((x) => x.cls.state === 'suspicious'), (x) => x.cls.reason)
  const uriOnly = rows.filter((x) => x.cls.state === 'suspicious' && x.cls.reason === 'uri').length
  const objStreams = rows.filter((x) => x.ev?.ok && x.ev.object_streams > 0).length
  const infoHidden = rows.filter((x) => x.ev?.ok && x.ev.info_reference_found && !x.ev.info_located).length
  const infoNone = rows.filter((x) => x.ev?.ok && !x.ev.info_reference_found && !x.ev.info_located).length

  const coverPaths = inventory.filter((r) => r.accepted && /(?:^|\/)(?:covers?|thumbs?|thumbnails?|posters?)(?:\/|[-_.])/i.test(r.path) && r.scope !== 'editor').map((r) => r.path)
  const rejected = inventory.filter((r) => !r.accepted)
  const rejectedReasons = count(rejected.flatMap((r) => r.reasons.map((x) => x.replace(/"[^"]*"/g, '"…"'))), (x) => x)

  const sections = {
    a_fully_recovered_books: {
      count: 0,
      statement: 'A book is fully recovered only when its record (title, author, category, price) and its file are both known and linked by a legacy book_media row. No legacy database exists here, so no book is fully recovered.',
    },
    b_partially_recovered_books: {
      candidate_files: rows.filter((x) => x.cls.state === 'clear_title').length,
      candidate_distinct_blobs: clear.length,
      distinct_titles: new Set(clear.map((b) => b.head.cls.title)).size,
      titles_shared_by_several_blobs: titleGroups.length,
      with_author_in_metadata: candidates.filter((c) => c.author).length,
      staged_and_importable_now: candidates.filter((c) => c.staging_status === 'staged').length,
      awaiting_staging: candidates.filter((c) => c.staging_status !== 'staged' && c.staging_status !== 'linked').length,
      statement: 'These are PDF files whose own metadata gives a clear title. The title comes from the file, not from a catalogue: price, author (unless embedded), category, publication state and purchase history are unknown, and the file-to-book relationship is the file itself, not a legacy record. They can become admin-review DRAFTS only.',
      examples: candidates.slice(0, 5).map((c) => ({ id: short(c.sha256), title: c.title, pages_estimate: c.pages_estimate })),
    },
    c_verified_relationships: {
      count: links.verified_links ?? 0,
      checked: links.checked,
      recovered_media_drafts_in_database: links.recovered_media_drafts,
      statement: links.checked
        ? 'Verified = a legacy book_media row (legacy_book_media_id) links the file to a book. The legacy database is missing, so none can exist. Draft books created from PDF metadata are NOT verified relationships.'
        : 'The link check could not reach the database; 0 is reported because no legacy book_media exists in any recovered input.',
    },
    d_unmatched_pdf_files: {
      files: pdfs.length,
      unique_blobs: blobs.length,
      duplicate_groups: dupGroups.length,
      files_in_duplicate_groups: dupGroups.reduce((n, b) => n + b.files, 0),
      redundant_copies: dupGroups.reduce((n, b) => n + b.files - 1, 0),
      matched_to_a_book: 0,
      by_state: sorted(byState),
      without_clear_title_blobs: blobs.filter((b) => b.state === 'no_clear_title').length,
      duplicate_group_examples: dupGroups.sort((a, b) => b.files - a.files || a.sha256.localeCompare(b.sha256)).slice(0, 5).map((b) => ({ id: short(b.sha256), copies: b.files })),
      statement: 'Every PDF is unmatched: nothing proves which book a file belongs to. File names are never used as evidence.',
    },
    e_missing_covers: {
      cover_files_recovered: coverPaths.length,
      books_needing_a_cover: candidates.length,
      statement: coverPaths.length ? 'Cover-like files exist; none is linked to a book.' : 'The recovered archive contains no cover images (only product_media and editor uploads); every candidate draft has no cover.',
      editor_images_not_covers: editor.filter((r) => r.accepted && EDITOR_CLASS[r.detected_type] === 'image').length,
    },
    f_rejected_or_suspicious: {
      inventory_rejected: rejected.length,
      inventory_rejected_by_reason: sorted(rejectedReasons),
      inventory_rejected_by_type: sorted(count(rejected, 'detected_type')),
      staging_rejected_rows: staging ? staging.filter((s) => s.status === 'rejected').length : null,
      pdf_suspicious_files: byState.suspicious ?? 0,
      pdf_suspicious_blobs: suspicious.length,
      pdf_suspicious_by_flag: sorted(flagTotals),
      pdf_suspicious_only_because_of_uri_links: uriOnly,
      pdf_suspicious_by_flag_set: sorted(suspiciousByFlagSet),
      pdf_suspicious_blobs_with_a_clear_title: suspicious.filter((b) => b.head.cls.titled).length,
      pdf_wrong_magic_bytes: byState.wrong_magic ?? 0,
      pdf_unreadable_or_missing: byState.unreadable ?? 0,
      pdf_integrity_mismatch: byState.integrity_mismatch ?? 0,
      pdf_encrypted: byState.encrypted ?? 0,
      pdf_with_compressed_object_streams: objStreams,
      pdf_info_reference_not_visible: infoHidden,
      pdf_without_info_dictionary: infoNone,
      other_product_media: sorted(count(other, (r) => `${r.detected_type}${r.accepted ? '' : ' (rejected)'}`)),
      examples: suspicious.slice(0, 3).map((b) => ({ id: short(b.sha256), flags: b.head.cls.reason })),
      statement: 'Suspicious means active-content keywords were found in the PDF structure; they were recorded, never followed. Content inside compressed object streams cannot be inspected without decoding, so a clean result is not a guarantee: the Defender scan and the content checks at staging still apply.',
    },
    g_historical_records_not_recoverable: {
      books: 0, categories: 0, makers: 0, customers: 0, orders: 0, payments: 0,
      statement: 'Books, categories, makers (authors/readers), customers, orders and payments exist only in the legacy database, which is not available. None of them can be recovered or inferred from the files; no price, author, category, relationship or purchase history has been guessed.',
    },
    editor_uploads: {
      files: editor.length,
      accepted: editor.filter((r) => r.accepted).length,
      rejected: editor.filter((r) => !r.accepted).length,
      by_type_and_state: sorted(count(editor, (r) => `${r.detected_type}/${r.accepted ? 'accepted' : 'rejected'}`)),
      by_class: sorted(count(editor, (r) => `${EDITOR_CLASS[r.detected_type] ?? 'other'}/${r.accepted ? 'accepted' : 'rejected'}`)),
      staging_status: staging ? sorted(count(staging.filter((s) => s.scope === 'editor'), 'status')) : null,
      statement: 'Editor uploads are images/videos pasted into legacy article editors. They are not product files and carry no book relationship.',
    },
  }
  return {
    generated_at: generatedAt, scan_mode: mode,
    inputs: { inventory_rows: inventory.length, product_rows: product.length, editor_rows: editor.length, staging_rows: staging ? staging.length : null, staging_product_status: stagingStatus },
    sections, candidates,
  }
}

const kv = (o) => Object.entries(o ?? {}).map(([k, v]) => `${k}: ${v}`).join('; ') || 'none'
const tableRows = (o) => Object.entries(o ?? {}).map(([k, v]) => `| ${k} | ${v} |`).join('\n') || '| none | 0 |'

export function renderReconciliationMd(r) {
  const s = r.sections
  const a = s.b_partially_recovered_books
  const d = s.d_unmatched_pdf_files
  const f = s.f_rejected_or_suspicious
  const e = s.editor_uploads
  return `# Media reconciliation (generated ${r.generated_at})

Built from migration-output/inventory.json, the quarantine folder and the local staging table. Nothing was written to any database. PDF scan mode: ${r.scan_mode}.

## (a) Genuine books fully recovered: ${s.a_fully_recovered_books.count}
${s.a_fully_recovered_books.statement}

## (b) Genuine books partially recovered: ${a.candidate_distinct_blobs} candidate blobs (${a.candidate_files} files)
${a.statement}

| Measure | Count |
|---|---:|
| candidate files / distinct blobs | ${a.candidate_files} / ${a.candidate_distinct_blobs} |
| distinct titles | ${a.distinct_titles} (${a.titles_shared_by_several_blobs} titles shared by several blobs: review for versions or duplicates) |
| author present in PDF metadata | ${a.with_author_in_metadata} |
| staged and importable now | ${a.staged_and_importable_now} |
| awaiting staging | ${a.awaiting_staging} |

Examples (id = first 12 hex of the SHA-256): ${a.examples.map((x) => `${x.id} "${x.title}" (~${x.pages_estimate ?? '?'} pp)`).join('; ') || 'none'}

## (c) Media files with verified relationships: ${s.c_verified_relationships.count}
${s.c_verified_relationships.statement} Draft books from recovered media currently in the checked database: ${s.c_verified_relationships.recovered_media_drafts_in_database ?? 'not checked'}.

## (d) Unmatched PDF files: ${d.files}
${d.statement}

| Measure | Count |
|---|---:|
| PDF files | ${d.files} |
| unique blobs (SHA-256) | ${d.unique_blobs} |
| duplicate groups / files in them / redundant copies | ${d.duplicate_groups} / ${d.files_in_duplicate_groups} / ${d.redundant_copies} |
| matched to a book | ${d.matched_to_a_book} |
| blobs without a clear title | ${d.without_clear_title_blobs} |

By state (files):

| State | Files |
|---|---:|
${tableRows(d.by_state)}

Largest duplicate groups: ${d.duplicate_group_examples.map((x) => `${x.id} x${x.copies}`).join('; ') || 'none'}

## (e) Missing covers
${s.e_missing_covers.statement} Cover files recovered: ${s.e_missing_covers.cover_files_recovered}. Candidate drafts that need a cover: ${s.e_missing_covers.books_needing_a_cover}.

## (f) Rejected or suspicious files
${f.statement}

| Measure | Count |
|---|---:|
| rejected at inventory | ${f.inventory_rejected} |
| rejected rows in staging | ${f.staging_rejected_rows ?? 'n/a'} |
| PDFs suspicious (files / blobs) | ${f.pdf_suspicious_files} / ${f.pdf_suspicious_blobs} |
| ... of which only because of /URI links | ${f.pdf_suspicious_only_because_of_uri_links} |
| PDFs with wrong magic bytes | ${f.pdf_wrong_magic_bytes} |
| PDFs unreadable or missing | ${f.pdf_unreadable_or_missing} |
| PDFs failing size/hash check vs inventory | ${f.pdf_integrity_mismatch} |
| PDFs encrypted | ${f.pdf_encrypted} |
| PDFs with compressed object streams (not fully inspectable) | ${f.pdf_with_compressed_object_streams} |
| PDFs whose Info dictionary is not visible | ${f.pdf_info_reference_not_visible} |
| PDFs without an Info dictionary | ${f.pdf_without_info_dictionary} |

Rejected at inventory, by reason:

| Reason | Files |
|---|---:|
${tableRows(f.inventory_rejected_by_reason)}

Suspicious PDFs by keyword (files): ${kv(f.pdf_suspicious_by_flag)}. By keyword combination: ${kv(f.pdf_suspicious_by_flag_set)}. Suspicious blobs that would otherwise have a clear title: ${f.pdf_suspicious_blobs_with_a_clear_title}. Other product media: ${kv(f.other_product_media)}.

## (g) Historical records that could not be recovered
${s.g_historical_records_not_recoverable.statement}

| Record | Recovered |
|---|---:|
| books | 0 |
| categories | 0 |
| makers | 0 |
| customers | 0 |
| orders | 0 |
| payments | 0 |

## Editor uploads (${e.files} files)
${e.statement} Accepted ${e.accepted}, rejected ${e.rejected}.

| Type / state | Files |
|---|---:|
${tableRows(e.by_type_and_state)}

By class: ${kv(e.by_class)}. Staging status of editor rows: ${kv(e.staging_status)}.
`
}
