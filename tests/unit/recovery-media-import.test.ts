import { describe, expect, it } from 'vitest'
// @ts-expect-error plain .mjs module without type declarations
import { analyzePdfBytes } from '../../scripts/recovery/lib/pdf-evidence.mjs'
// @ts-expect-error plain .mjs module without type declarations
import { EVIDENCE_NOTE, TITLE_MAX, applyImport, buildBookRow, eligibilityProblem, evidenceRows, groupBySha, loadExistingKeys, planImport, summarisePlan } from '../../scripts/recovery/lib/recovered-media-import.mjs'
import { literal, syntheticPdf } from '../helpers/synthetic-pdf'

const analyse = (info: Record<string, string>, extra: string[] = []) => analyzePdfBytes(syntheticPdf({ info, extraObjects: extra, pages: 5 }))
const good = () => analyse({ Title: literal('A Real Book Title'), Author: literal('Some Author') })

let nextId = 1
const stagingRow = (analysis: { sha256: string; size: number }, over: Record<string, unknown> = {}) => ({
  id: nextId++, legacy_path: `storage/app/public/product_media/f${nextId}.pdf`, sha256: analysis.sha256, byte_size: analysis.size,
  detected_type: 'pdf', scope: 'product', status: 'staged', duplicate_of: null, book_media_id: null, ...over,
})
const none = () => ({ evidenceShas: new Set<string>(), mediaShas: new Set<string>() })

describe('buildBookRow', () => {
  it('uses only evidence from the file: draft, paid, price 0, no raw cost, provenance recovered_media', () => {
    const a = good()
    const s = stagingRow(a)
    const row = buildBookRow({ analysis: a, staging: s })
    expect(row).toMatchObject({ title: 'A Real Book Title', kind: 'paid', status: 'draft', price_amount: 0, legacy_cost_raw: null, provenance: 'recovered_media', is_demo: false })
    expect(row.recovery_evidence).toEqual({
      source: 'pdf_metadata', sha256: a.sha256, byte_size: a.size,
      pdf: { title: 'A Real Book Title', author: 'Some Author', pages: 5, created: null },
      staging_id: s.id, note: EVIDENCE_NOTE,
    })
    expect(EVIDENCE_NOTE).toBe('price and original record unknown; admin review required')
    expect(Object.keys(row)).not.toEqual(expect.arrayContaining(['category', 'maker', 'owner_id', 'legacy_id', 'cover_path', 'legacy_verified_at']))
  })

  it('trims and caps the title at 250 characters', () => {
    const a = analyse({ Title: literal(`   ${'كتاب '.repeat(80)}   `) })
    const row = buildBookRow({ analysis: a, staging: stagingRow(a) })
    expect(row.title.length).toBeLessThanOrEqual(TITLE_MAX)
    expect(row.title).toBe(row.title.trim())
  })
})

describe('eligibilityProblem', () => {
  it('accepts a clean, titled, matching file', () => {
    const a = good()
    expect(eligibilityProblem(a, stagingRow(a))).toBeNull()
  })
  it.each([
    ['unclear title', () => analyse({ Title: literal('Microsoft Word - x.docx') }), 'no_clear_title'],
    ['no title', () => analyse({ Producer: literal('p') }), 'no_clear_title'],
    ['active content', () => analyse({ Title: literal('A Real Book Title') }, ['7 0 obj\n<< /S /Launch /F (x) >>\nendobj\n']), 'suspicious:launch'],
    ['encrypted', () => analyzePdfBytes(syntheticPdf({ encrypt: true, info: { Title: literal('A Real Book Title') } })), 'encrypted'],
  ])('rejects %s', (_n, make, expected) => {
    const a = make()
    expect(eligibilityProblem(a, stagingRow(a))).toBe(expected)
  })
  it('rejects a hash or size that differs from the staged row, and unreadable or missing evidence', () => {
    const a = good()
    expect(eligibilityProblem(a, stagingRow(a, { sha256: 'f'.repeat(64) }))).toBe('sha256_differs_from_staging')
    expect(eligibilityProblem(a, stagingRow(a, { byte_size: a.size + 1 }))).toBe('size_differs_from_staging')
    expect(eligibilityProblem({ ok: false, reason: 'no_pdf_header' }, stagingRow(a))).toBe('unreadable:no_pdf_header')
    expect(eligibilityProblem(undefined, stagingRow(a))).toBe('no_evidence')
  })
})

describe('planImport', () => {
  const build = (title: string, extra: string[] = []) => analyse({ Title: literal(title) }, extra)

  it('creates exactly one draft per distinct sha256, from the canonical (non-duplicate) staged row', () => {
    const a = good()
    const canonical = stagingRow(a, { legacy_path: 'p/a.pdf' })
    const dup1 = stagingRow(a, { legacy_path: 'p/copy_a.pdf', duplicate_of: canonical.id })
    const dup2 = stagingRow(a, { legacy_path: 'p/0.pdf', duplicate_of: canonical.id })
    const plan = planImport({ staging: [dup1, dup2, canonical], evidence: new Map([['p/a.pdf', a]]), existing: none() })
    expect(plan.create).toHaveLength(1)
    expect(plan.create[0]).toMatchObject({ sha256: a.sha256, legacy_path: 'p/a.pdf', duplicate_paths: 2, staging_id: canonical.id })
    expect(plan.skipped).toEqual([])
  })

  it('skips: not staged, no title, suspicious, hash mismatch, rejected rows and non-PDF or editor rows', () => {
    const titled = build('Staged Book Title')
    const inventoried = build('Not Staged Book')
    const untitled = analyse({ Producer: literal('p') })
    const risky = build('Risky Book Title', ['7 0 obj\n<< /S /JavaScript /JS (x) >>\nendobj\n'])
    const sRows = [
      stagingRow(titled, { legacy_path: 'p/1.pdf' }), stagingRow(inventoried, { legacy_path: 'p/2.pdf', status: 'inventoried' }),
      stagingRow(untitled, { legacy_path: 'p/3.pdf' }), stagingRow(risky, { legacy_path: 'p/4.pdf' }),
      stagingRow(titled, { legacy_path: 'p/5.png', detected_type: 'png' }), stagingRow(titled, { legacy_path: 'p/6.pdf', scope: 'editor', sha256: 'e'.repeat(64) }),
      stagingRow(titled, { legacy_path: 'p/7.pdf', status: 'rejected', sha256: 'd'.repeat(64) }),
    ]
    const ev = new Map([['p/1.pdf', titled], ['p/3.pdf', untitled], ['p/4.pdf', risky]])
    const plan = planImport({ staging: sRows, evidence: ev, existing: none() })
    expect(plan.create.map((c: { legacy_path: string }) => c.legacy_path)).toEqual(['p/1.pdf'])
    const reasons = Object.fromEntries(plan.skipped.map((s: { sha256: string; reason: string }) => [s.sha256, s.reason]))
    expect(reasons[inventoried.sha256]).toBe('not_staged')
    expect(reasons[untitled.sha256]).toBe('no_clear_title')
    expect(reasons[risky.sha256]).toBe('suspicious')
    expect(plan.skipped).toHaveLength(3)
  })

  it('is idempotent: hashes already drafted, already linked, or already attached to a book create nothing', () => {
    const a = build('Idempotent Book A')
    const b = build('Idempotent Book B')
    const c = build('Idempotent Book C')
    const ra = stagingRow(a, { legacy_path: 'p/a.pdf' })
    const rb = stagingRow(b, { legacy_path: 'p/b.pdf', status: 'linked', book_media_id: 9 })
    const rc = stagingRow(c, { legacy_path: 'p/c.pdf' })
    const ev = new Map([['p/a.pdf', a], ['p/b.pdf', b], ['p/c.pdf', c]])
    const plan = planImport({ staging: [ra, rb, rc], evidence: ev, existing: { evidenceShas: new Set([a.sha256]), mediaShas: new Set([c.sha256]) } })
    expect(plan.create).toEqual([])
    expect(summarisePlan(plan).skipped_by_reason).toEqual({ already_imported: 1, already_linked: 1, media_already_attached_to_a_book: 1 })
  })

  it('honours --limit and the assume-staged dry-run mode', () => {
    const xs = ['One Title Book', 'Two Title Book', 'Three Title Book'].map((t) => build(t))
    const sRows = xs.map((x, i) => stagingRow(x, { legacy_path: `p/${i}.pdf`, status: 'inventoried', id: null }))
    const ev = new Map(xs.map((x, i) => [`p/${i}.pdf`, x]))
    expect(planImport({ staging: sRows, evidence: ev, existing: none() }).create).toHaveLength(0)
    const plan = planImport({ staging: sRows, evidence: ev, existing: none(), assumeStaged: true, limit: 2 })
    expect(plan.create).toHaveLength(2)
    expect(plan.assumed_staged).toBe(true)
    expect(summarisePlan(plan).skipped_by_reason).toEqual({ over_limit: 1 })
  })

  it('marks fixture drafts as demo when asked', () => {
    const a = good()
    const plan = planImport({ staging: [stagingRow(a, { legacy_path: 'p/a.pdf' })], evidence: new Map([['p/a.pdf', a]]), existing: none(), isDemo: true })
    expect(plan.create[0].book.is_demo).toBe(true)
  })
})

describe('groupBySha', () => {
  it('prefers the non-duplicate row as canonical and ignores rejected, editor and non-PDF rows', () => {
    const a = good()
    const dup = stagingRow(a, { legacy_path: 'p/z.pdf', duplicate_of: 5 })
    const canon = stagingRow(a, { legacy_path: 'p/b.pdf' })
    const [g] = groupBySha([dup, canon, stagingRow(a, { status: 'rejected' }), stagingRow(a, { scope: 'editor' })])
    expect(g.canonical.legacy_path).toBe('p/b.pdf')
    expect(g.list).toHaveLength(2)
  })
})

describe('evidenceRows', () => {
  it('lists the canonical file of each ready blob with the staged hash and size (the importer verifies the file against them)', () => {
    const a = good()
    const b = analyse({ Title: literal('Another Title Here') })
    const groups = groupBySha([stagingRow(a, { legacy_path: 'p/a.pdf' }), stagingRow(b, { legacy_path: 'p/b.pdf', status: 'inventoried' })])
    expect(evidenceRows(groups)).toEqual([{ path: 'p/a.pdf', size: a.size, sha256: a.sha256 }])
  })
})

// ---- a tiny fake of the supabase-js query builder, enough to prove insert-only behaviour and the rollback ---------------------------------
function fakeDb() {
  const calls: { table: string; op: string; payload?: unknown }[] = []
  let id = 100
  const db = {
    calls,
    from(table: string) {
      const b: Record<string, unknown> = {}
      let op = 'select'
      let payload: unknown
      const self = {
        insert(p: unknown) { op = 'insert'; payload = p; calls.push({ table, op, payload }); return self },
        update(p: unknown) { op = 'update'; payload = p; calls.push({ table, op, payload }); return self },
        delete() { op = 'delete'; calls.push({ table, op }); return self },
        select() { return self },
        eq() { return self },
        in() { return self },
        single() { return Promise.resolve({ data: { id: ++id }, error: null }) },
        then(res: (v: unknown) => unknown) { return Promise.resolve({ data: [], error: null }).then(res) },
      }
      void b
      return self
    },
  }
  return db
}

describe('applyImport', () => {
  const makePlan = () => {
    const a = good()
    return planImport({ staging: [stagingRow(a, { legacy_path: 'p/a.pdf' })], evidence: new Map([['p/a.pdf', a]]), existing: none() })
  }

  it('inserts the book then links its media; never updates a book', async () => {
    const db = fakeDb()
    const linkMedia = async (_db: unknown, maps: { book_id: number; legacy_path: string; visibility: string; name: string }[]) => {
      expect(maps).toEqual([{ legacy_path: 'p/a.pdf', book_id: 101, visibility: 'after_purchase', name: 'A Real Book Title', kind: 'file' }])
      return { linked: [{ book_media_id: 7 }], skipped: [], failed: [] }
    }
    const r = await applyImport(db, makePlan(), { linkMedia })
    expect(r).toEqual({ created: [expect.objectContaining({ book_id: 101, book_media_id: 7 })], failed: [] })
    expect(db.calls.filter((c) => c.table === 'books').map((c) => c.op)).toEqual(['insert'])
    expect((db.calls[0]!.payload as { provenance: string; status: string }).provenance).toBe('recovered_media')
  })

  it('removes the draft again when its media cannot be attached', async () => {
    const db = fakeDb()
    const r = await applyImport(db, makePlan(), { linkMedia: async () => ({ linked: [], skipped: [], failed: [{ legacy_path: 'p/a.pdf', error: 'copy failed' }] }) })
    expect(r.created).toEqual([])
    expect(r.failed).toEqual([expect.objectContaining({ error: 'copy failed' })])
    expect(db.calls.map((c) => `${c.table}:${c.op}`)).toEqual(['books:insert', 'books:delete'])
  })
})

describe('loadExistingKeys', () => {
  it('collects draft hashes and attached-media hashes, in chunks', async () => {
    const seen: string[][] = []
    const db = {
      from: (table: string) => ({
        select: () => ({
          eq: () => ({ in: (_c: string, part: string[]) => { seen.push(part); return Promise.resolve({ data: part.slice(0, 1).map((sha) => ({ recovery_evidence: { sha256: sha } })), error: null }) } }),
          in: (_c: string, part: string[]) => Promise.resolve({ data: table === 'book_media' ? part.slice(-1).map((sha) => ({ sha256: sha })) : [], error: null }),
        }),
      }),
    }
    const shas = Array.from({ length: 150 }, (_, i) => String(i).padStart(64, '0'))
    const r = await loadExistingKeys(db, shas)
    expect(seen.map((p) => p.length)).toEqual([100, 50])
    expect(r.evidenceShas.size).toBe(2)
    expect(r.mediaShas.size).toBe(2)
  })
})
