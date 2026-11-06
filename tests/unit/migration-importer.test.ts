import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
// @ts-expect-error plain .mjs modules (no type declarations)
import { runImport, CATALOG_PHASES, SENSITIVE_PHASES } from '../../scripts/migration/lib/importer.mjs'
// @ts-expect-error plain .mjs modules
import { createFixtureSource, preflight, looksLikeMysqlDump, OWNER_CONFIRMATION, createMariaDbSource } from '../../scripts/migration/lib/source.mjs'
// @ts-expect-error plain .mjs modules
import { sanitizeRichText } from '../../scripts/migration/lib/sanitize.mjs'
// @ts-expect-error plain .mjs fixture
import { legacyMock } from '../fixtures/legacy-mock.mjs'

/** A database that explodes on first use: proves --dry-run performs no writes and no reads of the target. */
const forbiddenDb = new Proxy({}, { get: () => { throw new Error('dry-run touched the database') } })

describe('importer --dry-run', () => {
  it('runs every catalog + sensitive transform, writes nothing and reconciles V1 row counts', async () => {
    const source = createFixtureSource(legacyMock())
    const r = await runImport({ source, db: forbiddenDb, dryRun: true, phases: [...CATALOG_PHASES, ...SENSITIVE_PHASES], sanitize: sanitizeRichText })
    expect(r.runId).toBeNull()
    expect(r.counts['categories.would_upsert']).toBe(2)
    expect(r.counts['categories.rejected']).toBe(1)
    expect(r.counts['books.would_upsert']).toBe(3) // 900001, 900002, 900006 (archived)
    expect(r.counts['books.rejected']).toBe(3)
    expect(r.counts['articles.skipped_user_authored']).toBe(1)
    expect(r.counts['users.would_import']).toBe(2)
    expect(r.counts['orders.would_import']).toBe(3)
    expect(r.rejects.find((x: any) => x.entity === 'orders').reason).toMatch(/amount unusable/)
    const v1 = r.reconciliation.V1_row_counts
    expect(v1.categories).toMatchObject({ legacy_rows: 3, imported: 2, rejected: 1, balanced: true })
    expect(v1.books).toMatchObject({ legacy_rows: 6, imported: 3, rejected: 3, balanced: true })
    expect(v1.makers).toMatchObject({ legacy_rows: 2, imported: 1, rejected: 1, balanced: true })
    expect(v1.orders).toMatchObject({ legacy_rows: 4, balanced: true })
    expect(r.warnings.join('\n')).toMatch(/guest-checkout account/)
    expect(r.warnings.join('\n')).toMatch(/legacy unknown buyer/)
  })
  it('computes the V8 order total with exact decimals from the raw strings', async () => {
    const r = await runImport({ source: createFixtureSource(legacyMock()), db: forbiddenDb, dryRun: true, phases: ['orders'] })
    expect(r.reconciliation.V8).toMatchObject({ legacy_order_sum_by_exact_decimal: '1019.60', unparsable: 1 })
  })
})

describe('preflight', () => {
  it('refuses with the exact list of missing inputs when nothing is configured', async () => {
    const p = await preflight({})
    expect(p.ready).toBe(false)
    expect(p.missing).toHaveLength(2)
    expect(p.missing[0]).toMatch(/dump file path/)
    expect(p.missing[1]).toMatch(/restored read-only MariaDB/)
  })
  it('does not trust a .sql extension: the content must look like a dump', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'aw-dump-'))
    const fake = path.join(dir, 'x.sql'); writeFileSync(fake, 'hello world, not sql')
    const real = path.join(dir, 'y.sql'); writeFileSync(real, '-- MariaDB dump 10.19  Distrib 10.6\nCREATE TABLE `books` (id int);\n')
    expect((await preflight({ dumpPath: fake, dbHost: '127.0.0.1' })).missing.join()).toMatch(/does not look like/)
    expect((await preflight({ dumpPath: real, dbHost: '127.0.0.1' })).ready).toBe(true)
    rmSync(dir, { recursive: true, force: true })
    expect(looksLikeMysqlDump(Buffer.from('INSERT INTO `users` VALUES (1);'))).toBe(true)
  })
  it('never accepts a non-local legacy DB host (the VPS)', async () => {
    const p = await preflight({ dumpPath: undefined, dbHost: 'vps.example.com' })
    expect(p.missing.join()).toMatch(/must be local/)
    await expect(createMariaDbSource({ host: 'vps.example.com', user: 'x', database: 'y' })).rejects.toThrow(/non-local/)
  })
  it('sensitive phases need the owner authorisation flag AND the exact confirmation sentence', async () => {
    const base = { dumpPath: undefined, dbHost: '127.0.0.1', sensitive: true }
    expect((await preflight({ ...base, ownerAuthorised: true, confirm: 'yes' })).missing.join()).toMatch(/sensitive phases/)
    expect((await preflight({ ...base, ownerAuthorised: false, confirm: OWNER_CONFIRMATION })).missing.join()).toMatch(/sensitive phases/)
    expect((await preflight({ ...base, ownerAuthorised: true, confirm: OWNER_CONFIRMATION })).missing.join()).not.toMatch(/sensitive phases/)
  })
})
