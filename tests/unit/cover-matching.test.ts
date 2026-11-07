import { describe, expect, it } from 'vitest'
import { decideOriginalCover, matchCovers, parseCoverName, parsePdfEpoch, type BookRef, type CoverFile } from '../../shared/utils/coverMatching'
import { readImageInfo } from '../../shared/utils/imageInfo'

const T0 = 1_675_015_554 // 2023-01-29 18:05:54 UTC: the stamp in a real recovered PDF name
const pad = (n: number, w = 2) => String(n).padStart(w, '0')
/** product_cover/<time()><rand><date('Ymdis')>.webp, built the way convertImage() builds it (server clock = UTC here). */
function coverName(epoch: number, rand = 417) {
  const d = new Date(epoch * 1000)
  return `product_cover/${epoch}${rand}${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}.webp`
}
const cover = (epoch: number, sha = String(epoch).padEnd(64, 'a'), rand?: number): CoverFile => ({ file: coverName(epoch, rand), sha256: sha.slice(0, 64), bytes: 40_000 })
const book = (id: number, epoch: number | null): BookRef => ({ id, pdf_file: epoch == null ? null : `storage/app/public/product_media/أوراق عربية-${epoch}.pdf` })

describe('parseCoverName', () => {
  it('reads the stamp from an upload name and from a clone name', () => {
    expect(parseCoverName(coverName(T0))).toEqual({ epoch: T0, kind: 'upload', consistent: true })
    const d = new Date(T0 * 1000)
    const clone = `product_cover/copy_${T0}${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}.webp`
    expect(parseCoverName(clone)).toEqual({ epoch: T0, kind: 'copy', consistent: true })
  })
  it('accepts a random part of one to three digits', () => {
    for (const r of [7, 41, 999]) expect(parseCoverName(coverName(T0, r))?.epoch).toBe(T0)
  })
  it('flags a name whose date part disagrees with its stamp as not trustworthy', () => {
    const wrong = coverName(T0).replace(/(\d{2})(\d{2})\.webp$/, '5959.webp')
    expect(parseCoverName(wrong)?.consistent).toBe(false)
    const far = coverName(T0).replace(/\d{8}(\d{4})\.webp$/, '20200101$1.webp')
    expect(parseCoverName(far)?.consistent).toBe(false)
  })
  it('refuses anything that is not a legacy cover name', () => {
    for (const n of ['logo.png', 'cover.webp', 'product_cover/12345.webp', `${T0}.webp`, 'x'.repeat(30) + '.webp']) expect(parseCoverName(n), n).toBeNull()
  })
})

describe('parsePdfEpoch', () => {
  it('reads the stamp of a product file name', () => {
    expect(parsePdfEpoch('storage/app/public/product_media/أوراق عربية-1675015554.pdf')).toBe(1675015554)
    expect(parsePdfEpoch('product_media/copy_x-1675015554.mp3')).toBe(1675015554)
    expect(parsePdfEpoch('hibup.pdf')).toBeNull()
    expect(parsePdfEpoch(null)).toBeNull()
  })
})

describe('matchCovers', () => {
  it('VERIFIED: a cover and a PDF saved in the same second, alone in that window', () => {
    const [m] = matchCovers({ covers: [cover(T0)], books: [book(10, T0 + 1), book(11, T0 + 90_000)] })
    expect(m).toMatchObject({ book_id: 10, confidence: 'verified', method: 'same_request_timestamp', review_required: false })
    expect(m!.evidence.join(' ')).toMatch(/one request/)
  })
  it('the cover must not be later than the PDF in the same-request path', () => {
    const [m] = matchCovers({ covers: [cover(T0 + 1)], books: [book(10, T0)] })
    expect(m!.confidence).not.toBe('verified')
  })
  it('is NOT verified when two PDFs are within the window: ambiguous, so a person decides or nothing', () => {
    const [m] = matchCovers({ covers: [cover(T0)], books: [book(10, T0), book(11, T0 + 1)] })
    expect(m!.confidence).not.toBe('verified')
    expect(m!.evidence.join(' ')).toMatch(/not unique/)
  })
  it('is NOT verified from a name whose date part contradicts its stamp', () => {
    const bad = { ...cover(T0), file: coverName(T0).replace(/(\d{2})(\d{2})\.webp$/, '5959.webp') }
    const [m] = matchCovers({ covers: [bad], books: [book(10, T0)] })
    expect(m).toMatchObject({ book_id: null, confidence: 'unmatched' })
    expect(m!.evidence.join(' ')).toMatch(/NOT internally consistent/)
  })
  it('CANDIDATE: the ordinary flow, a cover and the next PDF added a few minutes later with nothing between', () => {
    const [m] = matchCovers({ covers: [cover(T0)], books: [book(10, T0 + 240)] })
    expect(m).toMatchObject({ book_id: 10, confidence: 'candidate', method: 'adjacent_timestamp', review_required: true })
  })
  it('a PDF more than 48 hours later is not even a candidate', () => {
    const [m] = matchCovers({ covers: [cover(T0)], books: [book(10, T0 + 3 * 86_400)] })
    expect(m).toMatchObject({ book_id: null, confidence: 'unmatched' })
  })
  it('another cover between a cover and its nearest PDF makes it ambiguous: unmatched', () => {
    const ms = matchCovers({ covers: [cover(T0), cover(T0 + 100)], books: [book(10, T0 + 300)] })
    const first = ms.find((m) => m.cover_file === coverName(T0))!
    expect(first).toMatchObject({ book_id: null, confidence: 'unmatched' })
    expect(ms.find((m) => m.cover_file === coverName(T0 + 100))).toMatchObject({ book_id: 10, confidence: 'candidate' })
  })
  it('STRONG CANDIDATE: the cover is visually the book\'s own first page, whatever the timestamps say', () => {
    const c = cover(T0 + 7 * 86_400)
    const [m] = matchCovers({ covers: [c], books: [book(10, T0), book(11, T0 + 10)], hashes: { covers: { [c.sha256]: 'ffff0000ffff0000' }, pages: { 10: 'ffff0000ffff0001', 11: '0000ffff0000ffff' } } })
    expect(m).toMatchObject({ book_id: 10, confidence: 'candidate_strong', method: 'visual_identity_with_own_pdf', review_required: true })
  })
  it('a cover that looks like the first page of two different PDFs is ambiguous', () => {
    const c = cover(T0 + 7 * 86_400)
    const [m] = matchCovers({ covers: [c], books: [book(10, T0), book(11, T0 + 5)], hashes: { covers: { [c.sha256]: 'ffff0000ffff0000' }, pages: { 10: 'ffff0000ffff0000', 11: 'ffff0000ffff0000' } } })
    expect(m!.confidence).toBe('unmatched')
    expect(m!.evidence.join(' ')).toMatch(/ambiguous/)
  })
  it('one image is never given to two books: identical files are one image', () => {
    const a = cover(T0, 'c'.repeat(64)), b = { ...cover(T0 + 5_000, 'c'.repeat(64)) }
    const ms = matchCovers({ covers: [a, b], books: [book(10, T0 + 1), book(11, T0 + 5_001)] })
    expect(ms).toHaveLength(1)
    expect(ms[0]!.evidence.join(' ')).toMatch(/identical content/)
  })
  it('one book is never given two covers: equal evidence loses both, stronger evidence wins', () => {
    // two different images saved in the same second, one PDF right after: nothing can say which is its cover
    const tie = matchCovers({ covers: [cover(T0, 'a'.repeat(64), 111), cover(T0, 'b'.repeat(64), 222)], books: [book(10, T0 + 2)] })
    expect(tie).toHaveLength(2)
    for (const m of tie) expect(m, m.cover_file).toMatchObject({ book_id: null, confidence: 'unmatched' })
    // a second cover two seconds away, even a further one, also prevents "verified" for the nearer one
    const crowded = matchCovers({ covers: [cover(T0, 'a'.repeat(64)), cover(T0 + 1, 'b'.repeat(64))], books: [book(10, T0 + 2)] })
    expect(crowded.every((m) => m.confidence !== 'verified')).toBe(true)
    const c1 = cover(T0 - 5_000, 'a'.repeat(64)), c2 = cover(T0 + 1, 'b'.repeat(64))
    const ms = matchCovers({ covers: [c1, c2], books: [book(10, T0 + 2)], hashes: { covers: { [c1.sha256]: 'ffffffffffffffff' }, pages: { 10: 'ffffffffffffffff' } } })
    expect(ms.filter((m) => m.book_id === 10)).toHaveLength(1)
  })
  it('a title can never create a match', () => {
    const [m] = matchCovers({ covers: [cover(T0)], books: [{ id: 10, title: 'عن شيء اسمه الحب', pdf_file: null }] })
    expect(m).toMatchObject({ book_id: null, confidence: 'unmatched' })
  })
})

describe('decideOriginalCover', () => {
  const m = (confidence: 'verified' | 'candidate' | 'candidate_strong' | 'unmatched', book_id: number | null = 10) => ({ confidence, sha256: 'a'.repeat(64), book_id })
  const none = { cover_path: null, recovery_evidence: null }
  it('attaches only a verified match, proposes the others, skips the unmatched', () => {
    expect(decideOriginalCover(none, m('verified')).action).toBe('attach')
    expect(decideOriginalCover(none, m('candidate')).action).toBe('candidate')
    expect(decideOriginalCover(none, m('candidate_strong')).action).toBe('candidate')
    expect(decideOriginalCover(none, m('unmatched', null)).action).toBe('skip')
  })
  it('may replace a generated cover but never an original or hand-uploaded one', () => {
    const generated = { cover_path: 'books/1/a.jpg', recovery_evidence: { cover: { current: { provenance: 'generated_from_pdf' } } } }
    expect(decideOriginalCover(generated, m('verified')).action).toBe('attach')
    for (const p of ['original_cover', 'admin_upload']) expect(decideOriginalCover({ cover_path: 'books/1/a.jpg', recovery_evidence: { cover: { current: { provenance: p } } } }, m('verified')).action).toBe('skip')
    expect(decideOriginalCover({ cover_path: 'books/1/a.jpg', recovery_evidence: null }, m('verified')).action).toBe('skip')
  })
  it('is idempotent', () => {
    expect(decideOriginalCover({ cover_path: 'books/1/a.jpg', recovery_evidence: { cover: { current: { provenance: 'original_cover', sha256: 'a'.repeat(64) } } } }, m('verified')).action).toBe('skip')
    expect(decideOriginalCover({ cover_path: null, recovery_evidence: { cover: { candidates: [{ provenance: 'original_cover', sha256: 'a'.repeat(64) }] } } }, m('candidate')).action).toBe('skip')
  })
})

describe('readImageInfo', () => {
  const le16 = (n: number) => [n & 255, n >> 8]
  it('reads WebP (lossy, lossless, extended), PNG, JPEG and GIF from their bytes, not their names', () => {
    const riff = (kind: string, body: number[]) => Uint8Array.from([...Buffer.from('RIFF'), 0, 0, 0, 0, ...Buffer.from('WEBP'), ...Buffer.from(kind), 0, 0, 0, 0, ...body])
    expect(readImageInfo(riff('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, ...le16(480), ...le16(700)]))).toMatchObject({ type: 'webp', width: 480, height: 700 })
    expect(readImageInfo(riff('VP8X', [0, 0, 0, 0, 0xdf, 0x01, 0x00, 0xbb, 0x02, 0x00]))).toMatchObject({ type: 'webp', width: 480, height: 700 })
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 1, 0xe0, 0, 0, 2, 0xbc])
    expect(readImageInfo(png)).toMatchObject({ type: 'png', width: 480, height: 700 })
    const jpg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, ...Array(14).fill(0), 0xff, 0xc0, 0, 17, 8, 0x02, 0xbc, 0x01, 0xe0, 3, ...Array(9).fill(0)])
    expect(readImageInfo(jpg)).toMatchObject({ type: 'jpeg', width: 480, height: 700 })
    expect(readImageInfo(Uint8Array.from([...Buffer.from('GIF89a'), ...le16(480), ...le16(700), 0, 0]))).toMatchObject({ type: 'gif', width: 480, height: 700 })
  })
  it('refuses everything else, including a PHP or HTML file renamed to .webp', () => {
    for (const bytes of ['<?php system($_GET[0]); ?>', '<html><script>alert(1)</script></html>', 'MZ\u0090\u0000\u0003', 'RIFFxxxxWAVEfmt ']) expect(readImageInfo(Buffer.from(bytes)), bytes).toBeNull()
    expect(readImageInfo(new Uint8Array(0))).toBeNull()
  })
})
