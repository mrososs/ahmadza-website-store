// Integration test of the recovered-media draft importer against the LOCAL dev stack, with synthetic rows only (is_demo = true, tagged titles).
// Everything it creates (books, media rows, staging rows, storage objects, temp files) is removed in afterAll.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
// @ts-expect-error plain .mjs module without type declarations
import { collectPdfEvidence } from '../../scripts/recovery/lib/evidence-collect.mjs'
// @ts-expect-error plain .mjs module without type declarations
import { applyImport, loadExistingKeys, planImport } from '../../scripts/recovery/lib/recovered-media-import.mjs'
// @ts-expect-error plain .mjs module without type declarations
import { checkTargetPolicy } from '../../scripts/migration/lib/target.mjs'
import { serviceClient } from '../helpers/supabase'
import { literal, syntheticPdf } from '../helpers/synthetic-pdf'

const db = serviceClient()
const tag = `[TEST-RMI-${randomUUID().slice(0, 8)}]`
const title = `${tag} Synthetic Recovered Book`
const bytes = syntheticPdf({ info: { Title: literal(title), Author: literal('Synthetic Author') }, pages: 4 })
const dir = path.join(tmpdir(), `rmi-${randomUUID()}`)
const legacyPath = `test-rmi/${tag}/synthetic.pdf`
const dupPath = `test-rmi/${tag}/copy_synthetic.pdf`
let sha = ''
const stagingIds: number[] = []
const bookIds: number[] = []
const objects: { bucket: string; path: string }[] = []

const loadStaging = async () => (await db.from('legacy_media_staging').select('*').like('legacy_path', `test-rmi/${tag}/%`).order('id')).data ?? []
async function runOnce() {
  const staging = await loadStaging()
  const rows = staging.filter((s) => s.detected_type === 'pdf').map((s) => ({ path: s.legacy_path, size: Number(s.byte_size), sha256: s.sha256 }))
  const collected = await collectPdfEvidence(rows, { root: dir })
  const evidence = new Map([...collected].map(([p, v]: [string, { analysis: unknown }]) => [p, v.analysis]))
  const existing = await loadExistingKeys(db, [sha])
  const plan = planImport({ staging, evidence, existing, isDemo: true })
  const applied = await applyImport(db, plan)
  applied.created.forEach((c: { book_id: number }) => bookIds.push(c.book_id))
  return { plan, applied }
}

beforeAll(async () => {
  await mkdir(path.join(dir, 'test-rmi', tag), { recursive: true })
  await writeFile(path.join(dir, ...legacyPath.split('/')), bytes)
  await writeFile(path.join(dir, ...dupPath.split('/')), bytes)
  const { createHash } = await import('node:crypto')
  sha = createHash('sha256').update(bytes).digest('hex')
  const objectPath = `sha256/${sha.slice(0, 2)}/${sha}.pdf`
  const up = await db.storage.from('legacy-staging').upload(objectPath, bytes, { contentType: 'application/pdf', upsert: true })
  expect(up.error).toBeNull()
  objects.push({ bucket: 'legacy-staging', path: objectPath })
  const base = { sha256: sha, byte_size: bytes.length, detected_type: 'pdf', scope: 'product', mime_type: 'application/pdf', status: 'staged' as const, storage_path: objectPath, av_result: 'clean', batch_id: `test-rmi-${tag}` }
  const canon = await db.from('legacy_media_staging').insert({ ...base, legacy_path: legacyPath }).select('id').single()
  expect(canon.error).toBeNull()
  stagingIds.push(canon.data!.id)
  const dup = await db.from('legacy_media_staging').insert({ ...base, legacy_path: dupPath, duplicate_of: canon.data!.id }).select('id').single()
  expect(dup.error).toBeNull()
  stagingIds.unshift(dup.data!.id) // duplicates are deleted first (self-referencing FK)
})

afterAll(async () => {
  if (bookIds.length) {
    const media = await db.from('book_media').select('storage_path').in('book_id', bookIds)
    for (const m of media.data ?? []) if (m.storage_path) objects.push({ bucket: 'private-products', path: m.storage_path })
    await db.from('books').delete().in('id', bookIds)
  }
  for (const id of stagingIds) await db.from('legacy_media_staging').delete().eq('id', id)
  for (const o of objects) await db.storage.from(o.bucket).remove([o.path])
  await rm(dir, { recursive: true, force: true })
})

describe('recovered-media draft import (synthetic fixture, dev stack)', () => {
  it('the target policy keeps this source kind away from dev (the test only uses the importer library)', () => {
    expect(checkTargetPolicy({ target: 'dev', sourceKind: 'recovered_media', targetEnv: { NUXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321' }, devEnv: {} }).ok).toBe(false)
    expect(checkTargetPolicy({ target: 'dev', sourceKind: 'fixture', targetEnv: { NUXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321' }, devEnv: {} }).ok).toBe(true)
  })

  it('creates ONE draft for the blob (the duplicate path creates nothing) with its media and evidence', async () => {
    const { plan, applied } = await runOnce()
    expect(plan.create).toHaveLength(1)
    expect(applied.failed).toEqual([])
    expect(applied.created).toHaveLength(1)

    const book = (await db.from('books').select('*').eq('id', bookIds[0]!).single()).data!
    expect(book).toMatchObject({ title, provenance: 'recovered_media', status: 'draft', kind: 'paid', price_amount: 0, legacy_cost_raw: null, is_demo: true, legacy_id: null, legacy_verified_at: null, owner_id: null })
    expect(book.recovery_evidence).toMatchObject({
      source: 'pdf_metadata', sha256: sha, byte_size: bytes.length, staging_id: stagingIds[1],
      pdf: { title, author: 'Synthetic Author', pages: 4 }, note: 'price and original record unknown; admin review required',
    })

    const media = (await db.from('book_media').select('*').eq('book_id', book.id)).data!
    expect(media).toHaveLength(1)
    expect(media[0]).toMatchObject({ visibility: 'after_purchase', sha256: sha, byte_size: bytes.length, legacy_book_media_id: null, legacy_path: legacyPath, migration_status: 'available', storage_provider: 'supabase' })
    const staged = await loadStaging()
    expect(staged.find((s) => s.legacy_path === legacyPath)).toMatchObject({ status: 'linked', book_media_id: media[0]!.id })
    expect(staged.find((s) => s.legacy_path === dupPath)).toMatchObject({ status: 'staged', book_media_id: null })
  })

  it('is idempotent and insert-only: a re-run creates nothing and an admin edit is never overwritten', async () => {
    const edited = `${title} (edited by an admin)`
    expect((await db.from('books').update({ title: edited }).eq('id', bookIds[0]!)).error).toBeNull()
    const again = await runOnce()
    expect(again.plan.create).toEqual([])
    expect(again.applied.created).toEqual([])
    expect(again.plan.skipped.length).toBeGreaterThan(0)
    const rows = (await db.from('books').select('id,title').eq('provenance', 'recovered_media').like('title', `${tag}%`)).data!
    expect(rows).toEqual([{ id: bookIds[0], title: edited }])
  })

  it('the database still refuses to publish the draft (unverified, no price)', async () => {
    const r = await db.from('books').update({ status: 'published' }).eq('id', bookIds[0]!)
    expect(r.error?.message).toMatch(/book_not_eligible/)
    expect((await db.from('books').select('status').eq('id', bookIds[0]!).single()).data!.status).toBe('draft')
  })
})
