// Catalog importer against the LOCAL database using MOCK fixture rows (legacy ids 900001+, is_demo = true).
// Cleans up after itself. Customer/financial phases are NOT run here: orders are append-only by design (delete is refused),
// so they are covered by the --dry-run unit tests only (see docs/implementation/07-historical-data-import.md).
import { afterAll, describe, expect, it } from 'vitest'
import { serviceClient } from '../helpers/supabase'
// @ts-expect-error plain .mjs modules (no type declarations)
import { runImport } from '../../scripts/migration/lib/importer.mjs'
// @ts-expect-error plain .mjs modules
import { createFixtureSource } from '../../scripts/migration/lib/source.mjs'
// @ts-expect-error plain .mjs modules
import { sanitizeRichText } from '../../scripts/migration/lib/sanitize.mjs'
// @ts-expect-error plain .mjs fixture
import { legacyMock } from '../fixtures/legacy-mock.mjs'

const svc = serviceClient()
const PHASES = ['categories', 'makers', 'books', 'book_media', 'related_books', 'articles', 'pages']
const runIds: number[] = []
const run = async () => {
  const r = await runImport({ source: createFixtureSource(legacyMock()), db: svc, phases: PHASES, sanitize: sanitizeRichText, markDemo: true })
  runIds.push(r.runId)
  return r
}

afterAll(async () => {
  const ids = [900001, 900002, 900003, 900004, 900005, 900006]
  await svc.from('books').delete().in('legacy_id', ids)
  await svc.from('categories').delete().in('legacy_id', ids)
  await svc.from('makers').delete().in('legacy_id', ids)
  await svc.from('articles').delete().in('legacy_id', ids)
  await svc.from('pages').delete().in('legacy_id', ids)
  await svc.from('legacy_id_map').delete().in('legacy_id', ids.map(String)).in('entity', ['categories', 'makers', 'books', 'articles', 'pages'])
  if (runIds.length) await svc.from('migration_runs').delete().in('id', runIds) // rejects cascade
})

describe('catalog import (mock fixture, local DB)', () => {
  it('imports, maps ids, keeps raw cost, links, sanitises and records rejects', async () => {
    const r = await run()
    expect(r.counts['books.imported']).toBe(3)
    expect(r.counts['books.rejected']).toBe(3)

    const { data: books } = await svc.from('books').select('legacy_id,title,kind,status,price_amount,legacy_cost_raw,deleted_at,is_demo').in('legacy_id', [900001, 900002, 900006]).order('legacy_id')
    expect(books).toHaveLength(3)
    expect(books![0]).toMatchObject({ kind: 'paid', status: 'published', price_amount: 12.5, legacy_cost_raw: '١٢٫٥٠', is_demo: true })
    expect(books![1]).toMatchObject({ kind: 'free', status: 'coming_soon', price_amount: 0 })
    expect(books![2]).toMatchObject({ status: 'archived', price_amount: 1234.57 })
    expect(books![2].deleted_at).not.toBeNull()

    const b1 = (await svc.from('books').select('id').eq('legacy_id', 900001).single()).data!.id
    const cats = await svc.from('book_categories').select('category_id').eq('book_id', b1)
    expect(cats.data).toHaveLength(1)
    const tags = await svc.from('book_tags').select('tag').eq('book_id', b1)
    expect(tags.data!.map((t) => t.tag).sort()).toEqual(['a', 'b'])
    expect((await svc.from('book_makers').select('role').eq('book_id', b1)).data).toEqual([{ role: 'author' }])

    const media = await svc.from('book_media').select('legacy_book_media_id,visibility,is_external,external_url,storage_path').eq('book_id', b1).order('legacy_book_media_id')
    expect(media.data).toHaveLength(2) // 900003 (no file) was rejected; 900001 is a placeholder (file not in staging); 900002 external
    expect(media.data![0]).toMatchObject({ visibility: 'after_purchase', is_external: false, storage_path: null })
    expect(media.data![1]).toMatchObject({ visibility: 'preview', is_external: true, external_url: 'https://example.invalid/x.pdf' })
    expect(r.warnings.join('\n')).toMatch(/missing_media: storage\/app\/public\/product_media\/missing-from-archive/)

    const maker = (await svc.from('makers').select('bio_html').eq('legacy_id', 900001).single()).data!
    expect(maker.bio_html).not.toMatch(/script/i)

    const rel = await svc.from('book_relations').select('book_id,related_id')
    expect(rel.data!.length).toBeGreaterThanOrEqual(1)

    expect((await svc.from('migration_rejects').select('entity,reason').eq('run_id', r.runId)).data!.length).toBe(r.rejects.length)
    expect((await svc.from('articles').select('legacy_id').in('legacy_id', [900001, 900002])).data).toEqual([{ legacy_id: 900001 }]) // user-authored one skipped
    const pages = (await svc.from('pages').select('slug,status').in('legacy_id', [900001, 900002]).order('legacy_id')).data!
    expect(pages.map((p) => p.slug)).toEqual(['terms-mock-legacy-900001', 'terms-mock'])
  })

  it('is idempotent: a second run creates no duplicates', async () => {
    const before = (await svc.from('books').select('id', { count: 'exact', head: true }).in('legacy_id', [900001, 900002, 900006])).count
    const mediaBefore = (await svc.from('book_media').select('id', { count: 'exact', head: true }).in('legacy_book_media_id', [900001, 900002])).count
    await run()
    expect((await svc.from('books').select('id', { count: 'exact', head: true }).in('legacy_id', [900001, 900002, 900006])).count).toBe(before)
    expect((await svc.from('book_media').select('id', { count: 'exact', head: true }).in('legacy_book_media_id', [900001, 900002])).count).toBe(mediaBefore)
    expect((await svc.from('categories').select('id', { count: 'exact', head: true }).in('legacy_id', [900001, 900002])).count).toBe(2)
    const map = await svc.from('legacy_id_map').select('legacy_id').eq('entity', 'books').in('legacy_id', ['900001', '900002', '900006'])
    expect(map.data).toHaveLength(3)
  })
})
