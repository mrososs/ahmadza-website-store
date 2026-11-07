import { describe, expect, it } from 'vitest'
// @ts-expect-error plain .mjs module without type declarations
import { classifyFirstPage, jpegSize, parseImageList, parsePageSize, pgmStats } from '../../scripts/recovery/lib/cover-pages.mjs'

// the real output of `pdfimages -list -f 1 -l 1` for a recovered book whose first page is one picture
const IMAGES = `page   num  type   width height color comp bpc  enc interp  object ID x-ppi y-ppi size ratio
--------------------------------------------------------------------------------------------
   1     0 image     705  1140  icc     3   8  jpeg   no       372  0   150   150 59.3K 2.5%
`

describe('parsePageSize', () => {
  it('reads both pdfinfo layouts and refuses nonsense', () => {
    expect(parsePageSize('Pages:           112\nPage size:       336.02 x 539.6 pts\n')).toEqual({ w: 336.02, h: 539.6 })
    expect(parsePageSize('Page    1 size: 595.276 x 841.89 pts (A4)\n')).toEqual({ w: 595.276, h: 841.89 })
    expect(parsePageSize('Page size: 0 x 10 pts')).toBeNull()
    expect(parsePageSize('')).toBeNull()
    expect(parsePageSize(undefined)).toBeNull()
  })
})

describe('parseImageList', () => {
  it('measures how much of the page the pictures cover', () => {
    const l = parseImageList(IMAGES)
    expect(l.images).toHaveLength(1)
    // 705/150*72 x 1140/150*72 = 338.4 x 547.2 pts on a 336.02 x 539.6 page: the picture fills the page (capped at 1)
    expect(l.coverage({ w: 336.02, h: 539.6 })).toBe(1)
    expect(l.coverage({ w: 1000, h: 1000 })).toBeCloseTo((338.4 * 547.2) / 1e6, 3)
    expect(l.coverage(null)).toBe(0)
  })
  it('ignores masks, headers and garbage', () => {
    const l = parseImageList(`${IMAGES}   1     1 smask     705  1140  gray    1   8  image  no       373  0   150   150  900B 0.1%\nnot a row\n`)
    expect(l.images).toHaveLength(1)
    expect(parseImageList('').images).toEqual([])
    expect(parseImageList(undefined).images).toEqual([])
  })
})

describe('pgmStats', () => {
  const pgm = (w: number, h: number, fill: (i: number) => number) => Buffer.concat([Buffer.from(`P5\n${w} ${h}\n255\n`), Buffer.from(Array.from({ length: w * h }, (_, i) => fill(i)))])
  it('calls a flat white or black page blank, and a varied page not', () => {
    expect(pgmStats(pgm(8, 8, () => 255)).blank).toBe(true)
    expect(pgmStats(pgm(8, 8, () => 0)).blank).toBe(true)
    expect(pgmStats(pgm(8, 8, () => 128)).blank).toBe(false) // flat grey is a picture of something
    const varied = pgmStats(pgm(8, 8, (i) => (i % 2 ? 20 : 230)))
    expect(varied.blank).toBe(false)
    expect(varied.std).toBeGreaterThan(80)
  })
  it('refuses anything that is not a complete binary PGM', () => {
    expect(() => pgmStats(Buffer.from('P6\n1 1\n255\n\0\0\0'))).toThrow()
    expect(() => pgmStats(Buffer.from('P5\n8 8\n255\n\0\0'))).toThrow()
  })
})

describe('jpegSize', () => {
  it('reads the frame size from the start-of-frame marker', () => {
    // SOI, APP0 (length 16), SOF0 (length 17): height 0x0258 = 600, width 0x01E0 = 480
    const soi = [0xff, 0xd8]
    const app0 = [0xff, 0xe0, 0x00, 0x10, ...Array(14).fill(0)]
    const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x58, 0x01, 0xe0, 0x03, 0, 0, 0, 0, 0, 0, 0, 0]
    expect(jpegSize(Buffer.from([...soi, ...app0, ...sof]))).toEqual({ w: 480, h: 600 })
  })
  it('returns null for anything that is not a JPEG', () => {
    expect(jpegSize(Buffer.from('RIFFxxxxWEBP'))).toBeNull()
    expect(jpegSize(Buffer.from([0xff, 0xd8]))).toBeNull()
    expect(jpegSize(null)).toBeNull()
  })
})

describe('classifyFirstPage', () => {
  it('high: one picture, almost no text', () => expect(classifyFirstPage({ coverage: 1, letters: 0, blank: false })).toMatchObject({ class: 'cover_like', confidence: 'high' }))
  it('a picture with a lot of text is not a confident cover', () => expect(classifyFirstPage({ coverage: 0.9, letters: 500, blank: false }).confidence).not.toBe('high'))
  it('medium: a drawn cover with a few words, or a partial picture', () => {
    expect(classifyFirstPage({ coverage: 0, letters: 25, blank: false })).toMatchObject({ class: 'uncertain', confidence: 'medium' })
    expect(classifyFirstPage({ coverage: 0.5, letters: 300, blank: false })).toMatchObject({ class: 'uncertain', confidence: 'medium' })
  })
  it('low: a page of text', () => expect(classifyFirstPage({ coverage: 0, letters: 800, blank: false })).toMatchObject({ class: 'text_page', confidence: 'low' }))
  it('a landscape or square first page is never "high": a slide or a banner is not a book cover', () => {
    expect(classifyFirstPage({ coverage: 1, letters: 0, blank: false, aspect: 0.56 })).toMatchObject({ class: 'uncertain', confidence: 'medium' })
    expect(classifyFirstPage({ coverage: 1, letters: 0, blank: false, aspect: 1.0 }).confidence).toBe('medium')
    expect(classifyFirstPage({ coverage: 1, letters: 0, blank: false, aspect: 1.45 }).confidence).toBe('high')
    expect(classifyFirstPage({ coverage: 1, letters: 0, blank: false }).confidence).toBe('high') // no aspect given: the other measurements decide
  })
  it('a blank page is never a cover, whatever else is measured', () => expect(classifyFirstPage({ coverage: 1, letters: 0, blank: true })).toMatchObject({ class: 'blank', confidence: 'none' }))
})
