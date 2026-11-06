import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { lstat, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
// @ts-expect-error plain .mjs module without type declarations
import { analyzePdfBytes } from '../../scripts/recovery/lib/pdf-evidence.mjs'
// @ts-expect-error plain .mjs module without type declarations
import { collectPdfEvidence, safeJoin } from '../../scripts/recovery/lib/evidence-collect.mjs'
// @ts-expect-error plain .mjs module without type declarations
import { buildReconciliation, classifyPdf, renderReconciliationMd } from '../../scripts/recovery/lib/reconciliation.mjs'
import { literal, syntheticPdf } from '../helpers/synthetic-pdf'

type Row = { path: string; size: number; mtime: string; scope: string; detected_type: string; sha256: string; accepted: boolean; reasons: string[]; extracted: boolean; mime_type: string }
const inv = (p: string, bytes: Buffer, over: Partial<Row> = {}): Row => ({
  path: p, size: bytes.length, mtime: '2023-01-01 00:00:00', scope: 'product', detected_type: 'pdf', sha256: analyzePdfBytes(bytes).sha256 ?? '0'.repeat(64),
  accepted: true, reasons: [], extracted: true, mime_type: 'application/pdf', ...over,
})
const ev = (bytes: Buffer) => ({ analysis: analyzePdfBytes(bytes), problems: [] as string[] })
const links = { verified_links: 0, recovered_media_drafts: 0, checked: true }

const titled = syntheticPdf({ info: { Title: literal('Distinct Book One'), Author: literal('An Author') } })
const titled2 = syntheticPdf({ info: { Title: literal('Distinct Book Two') } })
const untitled = syntheticPdf({ info: { Title: literal('Microsoft Word - x.docx'), Producer: literal('p') } })
const risky = syntheticPdf({ info: { Title: literal('Risky Book Title') }, extraObjects: ['7 0 obj\n<< /S /JavaScript /JS (x) >>\nendobj\n'] })
const base = 'storage/app/public/product_media/'

const fixture = () => {
  const inventory: Row[] = [
    inv(`${base}one.pdf`, titled), inv(`${base}copy_one.pdf`, titled), inv(`${base}two.pdf`, titled2), inv(`${base}three.pdf`, untitled), inv(`${base}risky.pdf`, risky),
    inv(`${base}a.mp3`, Buffer.from('ID3....'), { detected_type: 'mp3', mime_type: 'audio/mpeg', sha256: 'a'.repeat(64) }),
    inv('public/uploads/editor/x.png', Buffer.alloc(1000), { scope: 'editor', detected_type: 'png', sha256: 'b'.repeat(64) }),
    inv('public/uploads/editor/tiny.png', Buffer.alloc(81), { scope: 'editor', detected_type: 'png', sha256: 'c'.repeat(64), accepted: false, extracted: false, reasons: ['image below 256 B (probe/polyglot candidate)'] }),
    inv('public/uploads/editor/v.mp4', Buffer.alloc(5000), { scope: 'editor', detected_type: 'mp4', sha256: 'd'.repeat(64) }),
    inv('public/uploads/editor/s.svg', Buffer.alloc(500), { scope: 'editor', detected_type: 'svg', sha256: 'e'.repeat(64), accepted: false, extracted: false, reasons: ['content type "…" is not allow-listed for editor'] }),
    inv('public/uploads/editor/p.php', Buffer.alloc(500), { scope: 'editor', detected_type: 'php', sha256: 'f'.repeat(64), accepted: false, extracted: false, reasons: ['hostile markers inside content: php-open-tag'] }),
  ]
  const evidence = new Map([[`${base}one.pdf`, ev(titled)], [`${base}copy_one.pdf`, ev(titled)], [`${base}two.pdf`, ev(titled2)], [`${base}three.pdf`, ev(untitled)], [`${base}risky.pdf`, ev(risky)]])
  return { inventory, evidence }
}

describe('classifyPdf', () => {
  it('orders the states: unreadable/wrong magic, mismatch, suspicious, encrypted, clear, unclear', () => {
    expect(classifyPdf(ev(titled)).state).toBe('clear_title')
    expect(classifyPdf(ev(untitled)).state).toBe('no_clear_title')
    expect(classifyPdf(ev(risky))).toMatchObject({ state: 'suspicious', reason: 'javascript,js' })
    expect(classifyPdf({ analysis: analyzePdfBytes(Buffer.from('GIF89a......')), problems: [] }).state).toBe('wrong_magic')
    expect(classifyPdf({ analysis: { ok: false, reason: 'file_missing' }, problems: [] }).state).toBe('unreadable')
    expect(classifyPdf({ analysis: analyzePdfBytes(titled), problems: ['sha256_differs_from_inventory'] }).state).toBe('integrity_mismatch')
    expect(classifyPdf(undefined).state).toBe('not_analysed')
  })
})

describe('buildReconciliation', () => {
  const { inventory, evidence } = fixture()
  const r = buildReconciliation({ inventory, evidence, staging: null, links, generatedAt: '2026-11-06T00:00:00Z' })
  const s = r.sections

  it('states honestly that nothing is fully recovered and no relationship is verified', () => {
    expect(s.a_fully_recovered_books.count).toBe(0)
    expect(s.c_verified_relationships.count).toBe(0)
    expect(s.d_unmatched_pdf_files.matched_to_a_book).toBe(0)
    expect(s.g_historical_records_not_recoverable).toMatchObject({ books: 0, categories: 0, makers: 0, customers: 0, orders: 0, payments: 0 })
  })

  it('counts candidates by distinct blob, groups duplicates by sha256 and keeps evidence-only fields', () => {
    expect(s.b_partially_recovered_books).toMatchObject({ candidate_files: 3, candidate_distinct_blobs: 2, distinct_titles: 2, with_author_in_metadata: 1, staged_and_importable_now: 0 })
    expect(s.d_unmatched_pdf_files).toMatchObject({ files: 5, unique_blobs: 4, duplicate_groups: 1, files_in_duplicate_groups: 2, redundant_copies: 1, without_clear_title_blobs: 1 })
    expect(s.d_unmatched_pdf_files.duplicate_group_examples).toEqual([{ id: analyzePdfBytes(titled).sha256.slice(0, 12), copies: 2 }])
    expect(r.candidates.map((c: { title: string }) => c.title).sort()).toEqual(['Distinct Book One', 'Distinct Book Two'])
    expect(r.candidates[0]).not.toHaveProperty('price')
    expect(r.candidates.every((c: { staging_status: string }) => c.staging_status === 'unknown')).toBe(true)
  })

  it('reports suspicious, rejected, cover and editor-upload sections', () => {
    expect(s.f_rejected_or_suspicious).toMatchObject({ inventory_rejected: 3, pdf_suspicious_files: 1, pdf_suspicious_blobs: 1, pdf_suspicious_blobs_with_a_clear_title: 1, pdf_wrong_magic_bytes: 0, staging_rejected_rows: null })
    expect(s.f_rejected_or_suspicious.pdf_suspicious_by_flag).toEqual({ javascript: 1, js: 1 })
    expect(s.f_rejected_or_suspicious.inventory_rejected_by_reason['content type "…" is not allow-listed for editor']).toBe(1)
    expect(s.f_rejected_or_suspicious.other_product_media).toEqual({ mp3: 1 })
    expect(s.e_missing_covers).toMatchObject({ cover_files_recovered: 0, books_needing_a_cover: 2 })
    expect(s.editor_uploads).toMatchObject({ files: 5, accepted: 2, rejected: 3 })
    expect(s.editor_uploads.by_class).toMatchObject({ 'image/accepted': 1, 'image/rejected': 1, 'video/accepted': 1, 'vector/active/rejected': 1, 'script/rejected': 1 })
  })

  it('uses staging rows when present: importable now, awaiting staging, rejected rows', () => {
    const sha = analyzePdfBytes(titled).sha256
    const staging = [
      { id: 1, legacy_path: `${base}one.pdf`, sha256: sha, status: 'staged', scope: 'product', detected_type: 'pdf', duplicate_of: null, book_media_id: null },
      { id: 2, legacy_path: `${base}copy_one.pdf`, sha256: sha, status: 'staged', scope: 'product', detected_type: 'pdf', duplicate_of: 1, book_media_id: null },
      { id: 3, legacy_path: 'public/uploads/editor/tiny.png', sha256: 'c'.repeat(64), status: 'rejected', scope: 'editor', detected_type: 'png', duplicate_of: null, book_media_id: null },
    ]
    const r2 = buildReconciliation({ inventory, evidence, staging, links })
    expect(r2.sections.b_partially_recovered_books).toMatchObject({ staged_and_importable_now: 1, awaiting_staging: 1 })
    expect(r2.sections.f_rejected_or_suspicious.staging_rejected_rows).toBe(1)
    expect(r2.candidates.find((c: { sha256: string }) => c.sha256 === sha)).toMatchObject({ staging_id: 1, legacy_path: `${base}one.pdf`, files: 2 })
  })

  it('flags a file as suspicious only because of links when /URI is the only keyword', () => {
    const linky = syntheticPdf({ info: { Title: literal('Linked Book Title') }, extraObjects: ['7 0 obj\n<< /S /URI /URI (http://example.invalid) >>\nendobj\n'] })
    const r3 = buildReconciliation({ inventory: [inv(`${base}l.pdf`, linky)], evidence: new Map([[`${base}l.pdf`, ev(linky)]]), staging: null, links })
    expect(r3.sections.f_rejected_or_suspicious).toMatchObject({ pdf_suspicious_files: 1, pdf_suspicious_only_because_of_uri_links: 1 })
  })

  it('renders every required section and never claims a relationship', () => {
    const md = renderReconciliationMd(r)
    for (const h of ['(a) Genuine books fully recovered: 0', '(b) Genuine books partially recovered', '(c) Media files with verified relationships: 0', '(d) Unmatched PDF files: 5', '(e) Missing covers', '(f) Rejected or suspicious files', '(g) Historical records that could not be recovered', 'Editor uploads']) expect(md).toContain(h)
    expect(md).toMatch(/Nothing was written to any database/)
    expect(md).not.toMatch(/verified relationship(?:s)? (?:exist|found)/i)
  })
})

describe('safeJoin / collectPdfEvidence', () => {
  let dir: string
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'recon-'))
    await mkdir(path.join(dir, 'p'))
    await writeFile(path.join(dir, 'p', 'ok.pdf'), titled)
    await writeFile(path.join(dir, 'p', 'wrong.pdf'), Buffer.from('<?php echo 1; ?> padding padding'))
    await writeFile(path.join(dir, 'outside.pdf'), titled)
    await symlink(path.join(dir, 'outside.pdf'), path.join(dir, 'p', 'link.pdf')).catch(() => {})
  })
  afterAll(async () => { await rm(dir, { recursive: true, force: true }) })

  it('refuses paths that could leave the quarantine root', () => {
    for (const bad of ['../x.pdf', 'p/../../x.pdf', '/etc/passwd', 'C:/x.pdf', 'p\\x.pdf', 'p//x.pdf', '', 'a\0b']) expect(safeJoin(dir, bad), bad).toBeNull()
    expect(safeJoin(dir, 'p/ok.pdf')).toBe(path.join(dir, 'p', 'ok.pdf'))
  })

  it('reads inventory files, flags hash/size drift, wrong magic bytes, missing files and symlinks', async () => {
    const good = analyzePdfBytes(titled)
    const rows = [
      { path: 'p/ok.pdf', size: titled.length, sha256: good.sha256 },
      { path: 'p/ok.pdf', size: titled.length, sha256: 'f'.repeat(64) },
      { path: 'p/wrong.pdf', size: 33, sha256: '0'.repeat(64) },
      { path: 'p/missing.pdf', size: 1, sha256: '0'.repeat(64) },
      { path: 'p/link.pdf', size: titled.length, sha256: good.sha256 },
      { path: '../escape.pdf', size: 1, sha256: '0'.repeat(64) },
    ]
    const m = await collectPdfEvidence(rows, { root: dir })
    expect(m.get('p/ok.pdf')).toBeDefined()
    expect(m.get('p/wrong.pdf')!.analysis.reason).toBe('no_pdf_header')
    expect(m.get('p/missing.pdf')!.analysis.reason).toBe('file_missing')
    expect(m.get('../escape.pdf')!.analysis.reason).toBe('unsafe_path')
    const link = m.get('p/link.pdf')!.analysis
    if (await lstat(path.join(dir, 'p', 'link.pdf')).catch(() => null)) expect(link.reason).toBe('not_a_regular_file') // symlink creation can be denied on Windows
    const drift = await collectPdfEvidence([rows[1]!], { root: dir })
    expect(drift.get('p/ok.pdf')!.problems).toEqual(['sha256_differs_from_inventory'])
    const sizeDrift = await collectPdfEvidence([{ ...rows[0]!, size: 5 }], { root: dir })
    expect(sizeDrift.get('p/ok.pdf')!.problems).toEqual(['size_differs_from_inventory'])
  })
})
