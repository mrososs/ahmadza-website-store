import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
// @ts-expect-error plain .mjs modules (no type declarations)
import { classifyFile, sniffType, scanBuffer, MarkerScanner, unsafePathReason } from '../../scripts/migration/lib/classify.mjs'
// @ts-expect-error plain .mjs modules
import { readTar } from '../../scripts/migration/lib/tar.mjs'

const P = 'storage/app/public/product_media/'
const E = 'public/uploads/editor/'
const NUL = String.fromCharCode(0)
const bytes = (...parts: (string | number[])[]) => Buffer.concat(parts.map((p) => (typeof p === 'string' ? Buffer.from(p, 'latin1') : Buffer.from(p))))
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const pad = (b: Buffer, n: number) => Buffer.concat([b, Buffer.alloc(Math.max(0, n - b.length), 0x61)])

// Hostile markers are assembled at runtime from fragments: this source file must not contain literal signatures
// (Windows Defender rightly flags files that do). The bytes under test only ever exist in memory.
const j = (...p: string[]) => p.join('')
const PHP_OPEN = j('<', '?', 'p', 'h', 'p')
const HALT = j('__HALT', '_COMPILER')
const MVG = j('push graphic', '-context')
const HTTPD = j('x-http', 'd-php')
const PREPEND = j('auto_prepend', '_file')
const MP4_HEAD = j(NUL, NUL, NUL, String.fromCharCode(0x18), 'ftypisom')

describe('sniffType (magic bytes)', () => {
  it('recognises allow-listed types', () => {
    expect(sniffType(bytes('%PDF-1.7\n'))).toBe('pdf')
    expect(sniffType(bytes(PNG))).toBe('png')
    expect(sniffType(bytes([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg')
    expect(sniffType(bytes('GIF89a'))).toBe('gif')
    expect(sniffType(bytes(j('RIFF', NUL, NUL, NUL, NUL, 'WEBPVP8 ')))).toBe('webp')
    expect(sniffType(bytes('ID3', String.fromCharCode(3)))).toBe('mp3')
    expect(sniffType(bytes(MP4_HEAD))).toBe('mp4')
  })
  it('recognises non-allow-listed / hostile shapes', () => {
    expect(sniffType(bytes(PHP_OPEN, ' echo 1;'))).toBe('php')
    expect(sniffType(bytes('<svg xmlns="x"></svg>'))).toBe('svg')
    expect(sniffType(bytes('BM', NUL, NUL))).toBe('bmp')
    expect(sniffType(bytes(MVG, '\nfill'))).toBe('mvg')
    expect(sniffType(Buffer.alloc(0), 0)).toBe('empty')
  })
})

describe('classifyFile', () => {
  const pdf = pad(bytes('%PDF-1.4\n'), 4096)
  it('accepts a normal product PDF', () => {
    expect(classifyFile({ path: `${P}x-1700000000.pdf`, size: 4096, head: pdf })).toMatchObject({ accepted: true, detected_type: 'pdf', scope: 'product' })
  })
  it('rejects a PDF-named file whose content is not a PDF, and a PDF with the wrong extension', () => {
    expect(classifyFile({ path: `${P}x.pdf`, size: 9, head: bytes('PNG_TEST\n') }).accepted).toBe(false)
    expect(classifyFile({ path: `${P}x.png`, size: 4096, head: pdf }).reasons.join()).toMatch(/does not match content/)
  })
  it('rejects a PNG with a PHP tag appended (polyglot) when the scanner reports a marker', () => {
    const png = pad(bytes(PNG), 4000)
    const evil = Buffer.concat([png, bytes(PHP_OPEN, ' echo 1; ')])
    const markers = scanBuffer(evil, { weak: true })
    expect(markers).toContain('php-open-tag')
    const r = classifyFile({ path: `${E}a.png`, size: evil.length, head: evil, markers })
    expect(r.accepted).toBe(false)
    expect(r.reasons.join()).toMatch(/hostile markers/)
  })
  it('rejects the July-2026 probe shapes: MP4 with PHP, phar stub, MVG, .htaccess directives, tiny images, SVG', () => {
    const cases: [string, Buffer][] = [
      [`${E}a.mp4`, bytes(MP4_HEAD, PHP_OPEN, ' x ', HALT)],
      [`${E}b.bin`, bytes(PHP_OPEN, ' ', HALT, '();')],
      [`${E}c`, bytes(MVG, '\nviewbox 0 0 640 480')],
      [`${E}d.txt`, bytes('AddType application/', HTTPD, ' .gif\nphp_value ', PREPEND, ' /x')],
      [`${E}e.png`, bytes(PNG, [0, 0, 0, 0])],
      [`${E}f.svg`, bytes('<svg xmlns="http://www.w3.org/2000/svg"><', 'script>1</', 'script></svg>')],
      [`${E}.htaccess`, bytes('RewriteEngine On\n')],
    ]
    for (const [p, b] of cases) {
      const markers = scanBuffer(b, { weak: true })
      expect(classifyFile({ path: p, size: b.length, head: b, markers }).accepted, p).toBe(false)
    }
  })
  it('rejects zero-byte files and files outside the upload folders / with server-side extensions', () => {
    expect(classifyFile({ path: `${P}z.pdf`, size: 0, head: Buffer.alloc(0) }).reasons.join()).toMatch(/zero-byte/)
    expect(classifyFile({ path: 'app/Http/x.php', size: 10, head: bytes(PHP_OPEN) }).accepted).toBe(false)
    expect(classifyFile({ path: `${P}a.pdf.php`, size: 4096, head: pdf }).accepted).toBe(false)
  })
})

describe('MarkerScanner', () => {
  it('finds a marker split across two chunks', () => {
    const s = new MarkerScanner({ weak: false })
    s.update(bytes('xx<?p')).update(bytes('hp yy'))
    expect(s.found).toContain('php-open-tag')
  })
  it('weak markers are not applied to big binary content (random "<?=" in compressed data)', () => {
    expect(scanBuffer(bytes('abc<?=abc'), { weak: false })).toEqual([])
    expect(scanBuffer(bytes('abc<?=abc'), { weak: true })).toContain('php-short-tag')
  })
})

describe('unsafePathReason', () => {
  it('flags traversal, absolute, backslash and Windows-invalid names', () => {
    for (const p of ['../x', 'a/../../b', '/etc/passwd', 'C:/x', 'a\\b', 'a/b:c', 'a/b.', `x${NUL}y`]) expect(unsafePathReason(p), p).toBeTruthy()
    expect(unsafePathReason('storage/app/public/product_media/أوراق عربية-1.pdf')).toBeNull()
  })
})

describe('readTar (read-only reader)', () => {
  function header(name: string, size: number, type = '0', link = '') {
    const h = Buffer.alloc(512)
    h.write(name, 0, 'utf8'); h.write(`0000644${NUL}`, 100); h.write(`0000000${NUL}`, 108); h.write(`0000000${NUL}`, 116)
    h.write(size.toString(8).padStart(11, '0') + NUL, 124); h.write(`00000000000${NUL}`, 136)
    h.write('        ', 148); h.write(type, 156); h.write(link, 157); h.write(`ustar${NUL}`, 257); h.write('00', 263)
    let sum = 0; for (const b of h) sum += b
    h.write(sum.toString(8).padStart(6, '0') + NUL + ' ', 148)
    return h
  }
  const entry = (name: string, content: string, type = '0', link = '') => {
    const data = Buffer.from(content)
    const padded = Buffer.concat([data, Buffer.alloc((512 - (data.length % 512)) % 512)])
    return Buffer.concat([header(name, data.length, type, link), padded])
  }
  it('yields regular files, directories and flags special members without extracting anything', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'aw-tar-'))
    const file = path.join(dir, 't.tar')
    writeFileSync(file, Buffer.concat([
      entry('public/uploads/', '', '5'), entry('public/uploads/editor/a.png', 'hello'),
      entry('link-to-etc', '', '2', '/etc/passwd'), entry('hard', '', '1', 'x'),
      entry('storage/app/public/product_media/أوراق عربية-1.pdf', '%PDF-1.4'), Buffer.alloc(1024),
    ]))
    const out = []
    for await (const e of readTar(file)) out.push([e.name, e.type, e.size])
    rmSync(dir, { recursive: true, force: true })
    expect(out).toEqual([
      ['public/uploads/', '5', 0], ['public/uploads/editor/a.png', '0', 5], ['link-to-etc', '2', 0], ['hard', '1', 0],
      ['storage/app/public/product_media/أوراق عربية-1.pdf', '0', 8],
    ])
  })
})
