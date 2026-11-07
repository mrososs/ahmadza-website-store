import { describe, expect, it } from 'vitest'
import { escapeLike, passesEvidenceChecks, previewItemFromRow } from '../../shared/utils/recoveredPreview'

const SHA = 'a'.repeat(64)
const evidence = (over: Record<string, unknown> = {}, checks: Record<string, unknown> = {}) => ({
  sha256: SHA,
  byte_size: 923682,
  pdf: { pages: 112, title: 'عنوان من الملف', author: 'اسم غير موثق في بيانات الملف', created: '2016-01-08T17:31:17' },
  checks: { encrypted: false, malware_scan: 'clean', hash_verified: true, size_verified: true, active_content: 'none found', ...checks },
  source_file: { legacy_path: 'storage/app/public/product_media/x.pdf', original_name: 'أوراق عربية-1675015554.pdf' },
  uncertain: { price: 'unknown', author: 'not assigned' },
  ...over,
})
const row = (over: Record<string, unknown> = {}, checks: Record<string, unknown> = {}) => ({ id: 7, title: 'عن شيء اسمه الحب', recovery_evidence: evidence(over, checks) })

describe('previewItemFromRow (what a visitor of the protected preview may learn about a recovered book)', () => {
  it('returns exactly the whitelisted fields', () => {
    expect(previewItemFromRow(row())).toEqual({ id: 7, title: 'عن شيء اسمه الحب', pages: 112, size_bytes: 923682, original_name: 'أوراق عربية-1675015554.pdf', fingerprint: 'aaaaaaaaaaaa', scan: 'clean', cover_path: null, cover_provenance: null })
  })
  it('never carries an author, a price, a storage path of the PDF, the full hash or the PDF metadata', () => {
    const json = JSON.stringify(previewItemFromRow(row()))
    for (const forbidden of ['اسم غير موثق', 'author', 'price', 'storage', 'legacy_path', 'product_media', SHA, '2016-01-08', 'عنوان من الملف']) expect(json).not.toContain(forbidden)
    expect(Object.keys(previewItemFromRow(row())!).sort()).toEqual(['cover_path', 'cover_provenance', 'fingerprint', 'id', 'original_name', 'pages', 'scan', 'size_bytes', 'title'])
  })
  it('shows a cover only in the exact shape of a stored cover, with where it came from', () => {
    const withCover = (cover_path: unknown, provenance: unknown = 'generated_from_pdf') => previewItemFromRow({ ...row({ cover: { current: { provenance } } }), cover_path } as never)!
    expect(withCover('books/55/9fb2c1d4e6a7.jpg')).toMatchObject({ cover_path: 'books/55/9fb2c1d4e6a7.jpg', cover_provenance: 'generated_from_pdf' })
    expect(withCover('books/55/9fb2c1d4e6a7.webp', 'original_cover').cover_provenance).toBe('original_cover')
    for (const bad of ['https://evil.example/x.jpg', 'books/../secret.jpg', '../books/55/9fb2c1d4e6a7.jpg', 'private-sensitive/cover-candidates/55/9fb2c1d4e6a7.jpg', 'cover-candidates/55/9fb2c1d4e6a7.jpg', 'books/55/9fb2c1d4e6a7.pdf', 'books/55/a b.jpg', 'books/x/9fb2c1d4e6a7.jpg', '', null, 42]) {
      expect(withCover(bad).cover_path, String(bad)).toBeNull()
    }
  })
  it('states a provenance only when there is a cover, and only a known one', () => {
    expect(previewItemFromRow({ ...row({ cover: { current: { provenance: 'generated_from_pdf' } } }), cover_path: null } as never)!.cover_provenance).toBeNull()
    expect(previewItemFromRow({ ...row({ cover: { current: { provenance: 'made_up' } } }), cover_path: 'books/1/aaaaaaaaaaaa.jpg' } as never)!.cover_provenance).toBeNull()
  })
  it('never exposes cover candidates or their private paths', () => {
    const r = previewItemFromRow({ ...row({ cover: { current: null, candidates: [{ id: 'c1', bucket: 'private-sensitive', path: 'cover-candidates/7/aaaaaaaaaaaa.jpg', status: 'pending' }] } }), cover_path: null } as never)!
    const json = JSON.stringify(r)
    for (const forbidden of ['candidates', 'private-sensitive', 'cover-candidates', 'pending']) expect(json).not.toContain(forbidden)
  })
  it('lists nothing whose evidence is not clean, verified and unencrypted', () => {
    for (const checks of [{ malware_scan: 'infected' }, { malware_scan: undefined }, { hash_verified: false }, { size_verified: false }, { encrypted: true }, { active_content: 'javascript found' }, { active_content: undefined }]) {
      expect(previewItemFromRow(row({}, checks)), JSON.stringify(checks)).toBeNull()
    }
    expect(previewItemFromRow({ id: 1, title: 'x', recovery_evidence: null })).toBeNull()
    expect(previewItemFromRow({ id: 1, title: 'x', recovery_evidence: {} })).toBeNull()
  })
  it('refuses an empty title and a hash that is not a SHA-256', () => {
    expect(previewItemFromRow({ ...row(), title: '   ' })).toBeNull()
    expect(previewItemFromRow(row({ sha256: 'not-a-hash' }))).toBeNull()
    expect(previewItemFromRow(row({ sha256: undefined }))).toBeNull()
  })
  it('turns missing or odd numbers into null instead of inventing them', () => {
    expect(previewItemFromRow(row({ pdf: {} }))!.pages).toBeNull()
    expect(previewItemFromRow(row({ pdf: { pages: 0 } }))!.pages).toBeNull()
    expect(previewItemFromRow(row({ pdf: { pages: 3.5 } }))!.pages).toBeNull()
    expect(previewItemFromRow(row({ byte_size: -1 }))!.size_bytes).toBeNull()
    expect(previewItemFromRow(row({ byte_size: '99' }))!.size_bytes).toBeNull()
  })
  it('cleans and bounds the original file name, and drops it when absent', () => {
    expect(previewItemFromRow(row({ source_file: { original_name: 'a\u0000b\nc.pdf' } }))!.original_name).toBe('abc.pdf')
    expect(previewItemFromRow(row({ source_file: { original_name: 'x'.repeat(500) } }))!.original_name).toHaveLength(200)
    expect(previewItemFromRow(row({ source_file: {} }))!.original_name).toBeNull()
  })
})

describe('passesEvidenceChecks', () => {
  it('is true only for the full set of passing checks', () => {
    expect(passesEvidenceChecks(evidence())).toBe(true)
    expect(passesEvidenceChecks(undefined)).toBe(false)
    expect(passesEvidenceChecks({ checks: {} })).toBe(false)
  })
})

describe('escapeLike', () => {
  it('stops a search box from becoming a pattern', () => {
    expect(escapeLike('50%_off\\')).toBe('50\\%\\_off\\\\')
    expect(escapeLike('كتاب')).toBe('كتاب')
  })
})
