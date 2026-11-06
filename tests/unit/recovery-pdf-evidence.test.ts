import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
// @ts-expect-error plain .mjs module without type declarations
import { analyzePdfBytes, analyzePdfFile, classifyTitle, decodePdfTextString, parsePdfDate } from '../../scripts/recovery/lib/pdf-evidence.mjs'
import { hexOf, literal, syntheticPdf, utf16be } from '../helpers/synthetic-pdf'

describe('analyzePdfBytes: structure and Info dictionary', () => {
  it('reads size, sha256, version, page count and a literal-string Info dictionary', () => {
    const buf = syntheticPdf({ pages: 7, info: { Title: literal('Clean Code (2nd ed)'), Author: literal('A. Writer'), Producer: literal('Synthetic'), CreationDate: literal("D:20230704153012+03'00'") } })
    const r = analyzePdfBytes(buf)
    expect(r.ok).toBe(true)
    expect(r.sha256).toBe(createHash('sha256').update(buf).digest('hex'))
    expect(r.size).toBe(buf.length)
    expect(r.version).toBe('1.4')
    expect(r.pages).toEqual({ estimate: 7, source: 'pages_root_count' })
    expect(r.info).toMatchObject({ title: 'Clean Code (2nd ed)', author: 'A. Writer', producer: 'Synthetic' })
    expect(r.created).toBe('2023-07-04T15:30:12')
    expect(r.title).toBe('Clean Code (2nd ed)')
    expect(r.title_source).toBe('info')
    expect(r.title_quality.clear).toBe(true)
    expect(r.suspicious).toBe(false)
    expect(r.encrypted).toBe(false)
    expect(r.info_source).toBe('trailer_reference')
  })

  it('decodes hex strings, UTF-16BE with BOM and escapes in Arabic and Latin titles', () => {
    const arabic = 'كتاب الأمثال'
    const r1 = analyzePdfBytes(syntheticPdf({ info: { Title: hexOf(utf16be(arabic)), Author: hexOf(utf16be('محمد')) } }))
    expect(r1.info.title).toBe(arabic)
    expect(r1.info.author).toBe('محمد')
    expect(r1.title_quality.clear).toBe(true)
    const r2 = analyzePdfBytes(syntheticPdf({ info: { Title: '(Caf\\351 \\(demo\\) \\\\ 101\\101)' } }))
    expect(r2.info.title).toBe('Café (demo) \\ 101A')
    const r3 = analyzePdfBytes(syntheticPdf({ info: { Title: '<4865 6C6C6F2>' } })) // odd digit count is padded with 0
    expect(r3.info.title).toBe('Hello')
  })

  it('falls back to the XMP dc:title when the Info dictionary has none', () => {
    const r = analyzePdfBytes(syntheticPdf({ info: { Producer: literal('Tool') }, xmpTitle: 'Moby &amp; Dick' }))
    expect(r.info.title).toBeNull()
    expect(r.xmp.title).toBe('Moby & Dick')
    expect(r.title).toBe('Moby & Dick')
    expect(r.title_source).toBe('xmp')
  })

  it('prefers whichever of Info/XMP titles actually establishes identity', () => {
    const r = analyzePdfBytes(syntheticPdf({ info: { Title: literal('Microsoft Word - draft.docx') }, xmpTitle: 'The Real Title' }))
    expect(r.title).toBe('The Real Title')
    expect(r.title_source).toBe('xmp')
  })

  it('does not present the title of an encrypted file (its strings cannot be decoded)', () => {
    const r = analyzePdfBytes(syntheticPdf({ encrypt: true, info: { Title: literal('Looks Fine Title') } }))
    expect(r.encrypted).toBe(true)
    expect(r.title).toBeNull()
    expect(r.title_quality.clear).toBe(false)
  })

  it('reports an Info reference whose object is not visible (compressed object stream) and never guesses a title', () => {
    const r = analyzePdfBytes(syntheticPdf({ info: { Title: literal('Hidden') }, infoInObjectStream: true }))
    expect(r.ok).toBe(true)
    expect(r.info_reference_found).toBe(true)
    expect(r.info_located).toBe(false)
    expect(r.title).toBeNull()
  })

  it('ignores outline /Title entries that belong to bookmarks, not to the Info dictionary', () => {
    const r = analyzePdfBytes(syntheticPdf({ extraObjects: ['7 0 obj\n<< /Title (Chapter 1) /Parent 8 0 R /Dest [10 0 R /Fit] >>\nendobj\n'] }))
    expect(r.title).toBeNull()
  })
})

describe('analyzePdfBytes: active content and malformed input', () => {
  const act = (extra: string) => analyzePdfBytes(syntheticPdf({ info: { Title: literal('Some Book Name') }, extraObjects: [extra] }))

  it('flags JavaScript, JS, Launch, OpenAction, EmbeddedFile, AA and URI as suspicious without following them', () => {
    const r = act('7 0 obj\n<< /S /JavaScript /JS (app.alert(1)) >>\nendobj\n8 0 obj\n<< /S /Launch /F (cmd.exe) >>\nendobj\n9 0 obj\n<< /Type /EmbeddedFile >>\nendobj\n20 0 obj\n<< /AA << /O 7 0 R >> /A << /S /URI /URI (http://example.invalid) >> >>\nendobj\n')
    expect(r.suspicious).toBe(true)
    expect(r.flags).toMatchObject({ javascript: 1, js: 1, launch: 1, embedded_file: 1, aa: 1, uri: 1 })
    expect(r.suspicious_reasons).toEqual(expect.arrayContaining(['javascript', 'js', 'launch', 'embedded_file', 'aa', 'uri']))
  })

  it('counts an /OpenAction that may run something, but not a destination array or a plain GoTo jump', () => {
    expect(act('1 0 obj\n<< /OpenAction [10 0 R /Fit] >>\nendobj\n').flags.open_action).toBe(0)
    expect(act('1 0 obj\n<< /OpenAction 7 0 R >>\nendobj\n').flags.open_action).toBe(1) // target not visible: stays counted
    expect(act('1 0 obj\n<< /OpenAction 7 0 R >>\nendobj\n7 0 obj\n<< /S /GoTo /D [10 0 R /Fit] >>\nendobj\n').flags.open_action).toBe(0)
    expect(act('1 0 obj\n<< /OpenAction << /S /GoTo /D [10 0 R /Fit] >> >>\nendobj\n').flags.open_action).toBe(0)
    expect(act('1 0 obj\n<< /OpenAction << /S /Named /N /Print >> >>\nendobj\n').flags.open_action).toBe(1)
    const r = act('1 0 obj\n<< /OpenAction 7 0 R >>\nendobj\n7 0 obj\n<< /S /Launch /F (x.exe) >>\nendobj\n')
    expect(r.suspicious_reasons).toEqual(expect.arrayContaining(['launch', 'open_action']))
  })

  it('sees through #-escaped names', () => {
    expect(act('7 0 obj\n<< /S /J#61vaScr#69pt /J#53 (x) >>\nendobj\n').flags).toMatchObject({ javascript: 1, js: 1 })
  })

  it('does not count look-alike keywords inside binary stream bodies', () => {
    const r = analyzePdfBytes(syntheticPdf({ info: { Title: literal('Some Book Name') }, padStreamBytes: 300_000 }))
    expect(r.suspicious).toBe(false)
    expect(r.flags).toEqual({ javascript: 0, js: 0, launch: 0, open_action: 0, embedded_file: 0, aa: 0, uri: 0 })
  })

  it('refuses wrong magic bytes, a header that is not at offset 0, and tiny or empty input without throwing', () => {
    expect(analyzePdfBytes(Buffer.from('<?php echo 1; ?> padding padding')).reason).toBe('no_pdf_header')
    expect(analyzePdfBytes(Buffer.concat([Buffer.from('GIF89a\n'), syntheticPdf()])).reason).toBe('pdf_header_not_at_start')
    expect(analyzePdfBytes(Buffer.alloc(0)).reason).toBe('too_small')
    // @ts-expect-error deliberately wrong input
    expect(analyzePdfBytes(undefined).ok).toBe(false)
  })

  it('never throws on truncated or garbage content after a valid header', () => {
    const good = syntheticPdf({ info: { Title: literal('Some Book Name') } })
    for (const cut of [10, 60, 200, good.length - 30]) expect(() => analyzePdfBytes(good.subarray(0, cut))).not.toThrow()
    const junk = Buffer.concat([Buffer.from('%PDF-1.7\n1 0 obj\n<< /Title (unterminated '), Buffer.alloc(5000, 0x28)])
    const r = analyzePdfBytes(junk)
    expect(r.ok).toBe(true)
    expect(r.title).toBeNull()
  })
})

describe('analyzePdfFile: bounded reads on disk', () => {
  let dir: string
  beforeAll(async () => { dir = await mkdtemp(path.join(tmpdir(), 'pdf-evidence-')) })
  afterAll(async () => { await rm(dir, { recursive: true, force: true }) })

  it('streams a multi-megabyte file: same hash, title, pages and no false flags', async () => {
    const buf = syntheticPdf({ pages: 4, info: { Title: literal('Large Synthetic Book'), Producer: literal('t') }, padStreamBytes: 3_500_000 })
    const file = path.join(dir, 'large.pdf')
    await writeFile(file, buf)
    const r = await analyzePdfFile(file)
    expect(r.ok).toBe(true)
    expect(r.scan.mode).toBe('full')
    expect(r.sha256).toBe(createHash('sha256').update(buf).digest('hex'))
    expect(r.title).toBe('Large Synthetic Book')
    expect(r.pages.estimate).toBe(4)
    expect(r.suspicious).toBe(false)
  })

  it('edges mode reads only the first and last MiB (no hash) and still finds a trailer Info dictionary', async () => {
    const buf = syntheticPdf({ info: { Title: literal('Edge Mode Book'), Producer: literal('t') }, padStreamBytes: 3_500_000 })
    const file = path.join(dir, 'edges.pdf')
    await writeFile(file, buf)
    const r = await analyzePdfFile(file, { mode: 'edges' })
    expect(r.ok).toBe(true)
    expect(r.scan).toEqual({ mode: 'edges', bytes: 2 * 1024 * 1024 })
    expect(r.sha256).toBeNull()
    expect(r.title).toBe('Edge Mode Book')
    expect(r.suspicious).toBe(false)
  })

  it('switches to edges automatically above the full-scan limit', async () => {
    const file = path.join(dir, 'limit.pdf')
    await writeFile(file, syntheticPdf({ info: { Title: literal('Over The Limit') }, padStreamBytes: 3_000_000 }))
    expect((await analyzePdfFile(file, { fullScanLimit: 1_000_000 })).scan.mode).toBe('edges')
  })

  it('returns reasons instead of throwing for a missing file, a non-PDF and a directory', async () => {
    expect((await analyzePdfFile(path.join(dir, 'nope.pdf'))).reason).toBe('file_missing')
    const png = path.join(dir, 'x.pdf')
    await writeFile(png, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(300)]))
    expect((await analyzePdfFile(png)).reason).toBe('no_pdf_header')
    expect((await analyzePdfFile(dir)).ok).toBe(false)
  })
})

describe('decodePdfTextString / parsePdfDate', () => {
  it('handles UTF-16LE BOM, UTF-8 BOM, raw UTF-8, PDFDocEncoding specials and drops controls', () => {
    expect(decodePdfTextString(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Hi', 'utf16le')]))).toBe('Hi')
    expect(decodePdfTextString(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('كتاب')]))).toBe('كتاب')
    expect(decodePdfTextString(Buffer.from('كتاب'))).toBe('كتاب')
    expect(decodePdfTextString(Buffer.from([0x80, 0x20, 0x41, 0x92]))).toBe('• A™')
    expect(decodePdfTextString(Buffer.from([0x41, 0x00, 0x42, 0x01]))).toBe('AB')
  })
  it('parses PDF dates and rejects nonsense', () => {
    expect(parsePdfDate('D:20200102')).toBe('2020-01-02T00:00:00')
    expect(parsePdfDate('D:19790101000000')).toBeNull()
    expect(parsePdfDate('D:20201399')).toBeNull()
    expect(parsePdfDate('garbage')).toBeNull()
    expect(parsePdfDate(null)).toBeNull()
  })
})

describe('classifyTitle', () => {
  const clear = (t: unknown) => classifyTitle(t).clear
  it('accepts real Arabic and Latin titles', () => {
    for (const t of ['كتاب الأمثال العربية', 'أوراق عربية', 'Clean Code', 'Pride and Prejudice', 'The C Programming Language: 2nd Edition', 'ABC']) expect(clear(t), t).toBe(true)
  })
  it('rejects empty, software and filename artefacts', () => {
    for (const t of [null, undefined, '', '   ', 'Untitled', 'untitled - 2', 'Document1', 'Microsoft Word - report', 'Microsoft® Word - x', 'Adobe InDesign', 'thesis.docx', 'layout.indd', 'scan_001.pdf', '~$temp', 'tmp123', 'بدون عنوان', 'C:\\Users\\a\\book.pdf', 'Title-1670091761', 'PDF', 'Adobe Acrobat Distiller 9']) expect(clear(t), String(t)).toBe(false)
  })
  it('rejects digits-only, tiny, non Latin/Arabic and hash-like tokens', () => {
    for (const t of ['12345', '2022-12-03', 'ab', 'x', '١٢٣', '!!!', 'Привет мир', '5e89879184510e91e477d41c61bd86a0', 'HYGsf1UZYTavLgUwG03UFy0RZv6WRKL1gmvI8Koa', '3f2504e0-4f89-11d3-9a0c-0305e82c3301']) expect(clear(t), String(t)).toBe(false)
  })
  it('rejects damaged encodings', () => {
    expect(clear('Ø§Ù„ÙƒØªØ§Ø¨ Ø§Ù„Ø¹Ø±Ø¨ÙŠ')).toBe(false)
    expect(clear('bad \ufffd title')).toBe(false)
  })
  it('reports why', () => {
    expect(classifyTitle('Untitled').reasons).toContain('software_default')
    expect(classifyTitle('12345').reasons).toEqual(expect.arrayContaining(['digits_or_symbols_only', 'fewer_than_3_letters']))
  })
})
