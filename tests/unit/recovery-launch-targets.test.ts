import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
// @ts-expect-error plain .mjs module without type declarations
import { classifyTarget, parseFilespecWindow, parseLaunchWindow, scanFileForLaunch, verdictFor } from '../../scripts/recovery/lib/launch-targets.mjs'

describe('parseLaunchWindow', () => {
  it('reads the file target, parameters, directory and platform blocks of an action', () => {
    expect(parseLaunchWindow(' /F (report.pdf) /NewWindow true >> endobj')).toMatchObject({ target: 'report.pdf', has_params: false, has_directory: false, new_window: true })
    expect(parseLaunchWindow(' /Win << /F (calc.exe) /P (/c whoami) /D (C:\\\\) >> >>')).toMatchObject({ target: 'calc.exe', has_params: true, has_directory: true, platform_blocks: ['/Win'] })
  })
  it('decodes escaped literal strings and hex strings', () => {
    expect(parseLaunchWindow(' /F (a\\(1\\).pdf) >>').target).toBe('a(1).pdf')
    expect(parseLaunchWindow(' /F <6e6f74652e747874> >>').target).toBe('note.txt')
  })
  it('returns no target (never throws) for anything unreadable', () => {
    expect(parseLaunchWindow('').target).toBeNull()
    expect(parseLaunchWindow('garbage \u0000\u0001 /F ((((').target).toBeNull()
  })
  it('keeps an indirect file specification as a reference to resolve, not as a target', () => {
    expect(parseLaunchWindow(' /NewWindow false>> endobj')).toMatchObject({ target: null, ref: null })
    expect(parseLaunchWindow('/F 471 0 R /NewWindow false>> endobj')).toMatchObject({ target: null, ref: 471 })
  })
  it('reads the name of a file specification, and treats /FS /URL as a URL', () => {
    expect(parseFilespecWindow('<</F(hibup.pdf)/Type/Filespec>>\nendobj')).toBe('hibup.pdf')
    expect(parseFilespecWindow('<</UF(a.pdf)/Type/Filespec>>')).toBe('a.pdf')
    expect(classifyTarget(parseFilespecWindow('<</FS/URL/F(evil.example/a.pdf)>>'))).toBe('url_or_script')
    expect(parseFilespecWindow('<</Type/Filespec>>')).toBeNull()
  })
  it('does not read past the end of the object', () => {
    expect(parseLaunchWindow(' >> endobj 7 0 obj << /F (other.exe) >>').target).toBeNull()
  })
})

describe('classifyTarget', () => {
  it.each([
    ['report.pdf', 'document_same_folder'], ['Notes.DOCX', 'document_same_folder'], ['sub/folder/a.pdf', 'document_in_subfolder'],
    ['setup.exe', 'executable_or_script'], ['run.BAT', 'executable_or_script'], ['x.js', 'executable_or_script'], ['macro.docm', 'executable_or_script'], ['a.lnk', 'executable_or_script'],
    ['http://example.invalid/a.pdf', 'url_or_script'], ['javascript:alert(1)', 'url_or_script'], ['file:///c:/x.pdf', 'url_or_script'],
    ['C:\\Windows\\system32\\cmd.exe', 'absolute_or_network_path'], ['\\\\server\\share\\a.pdf', 'absolute_or_network_path'], ['/etc/passwd', 'absolute_or_network_path'],
    ['../../secret.pdf', 'path_traversal'], ['a/../../b.pdf', 'path_traversal'],
    ['README', 'no_extension'], ['archive.xyz', 'unknown_extension'], ['', 'no_target'], [null, 'no_target'],
  ])('%j -> %s', (t, c) => { expect(classifyTarget(t)).toBe(c) })
  it('the most dangerous reading wins: a URL that ends in .pdf is still a URL', () => {
    expect(classifyTarget('https://x.invalid/a.pdf')).toBe('url_or_script')
  })
})

describe('verdictFor (a verdict is only ever "a human may look", never an approval)', () => {
  const a = (target: string | null, over: Record<string, unknown> = {}) => ({ target, has_params: false, has_directory: false, platform_blocks: [], new_window: false, ...over })
  it('reviewable only when every action points at a plain document next to the file, with no parameters', () => {
    expect(verdictFor([a('x.pdf'), a('y.docx')])).toBe('reviewable')
  })
  it('blocked as soon as one action could run code, leave the folder, or carries parameters', () => {
    for (const actions of [[a('x.pdf'), a('x.exe')], [a('http://x.invalid')], [a('../x.pdf')], [a('x.pdf', { has_params: true })], [a('x.pdf', { has_directory: true })], [a(null)], [a('README')]]) {
      expect(verdictFor(actions)).toBe('blocked')
    }
  })
  it('inconclusive when a Launch keyword has no readable action', () => {
    expect(verdictFor([])).toBe('inconclusive')
  })
})

describe('scanFileForLaunch', () => {
  let dir = ''
  beforeAll(async () => { dir = await mkdtemp(path.join(tmpdir(), 'aawraq-launch-')) })
  afterAll(async () => { await rm(dir, { recursive: true, force: true }) })
  const MIB = 1024 * 1024
  const put = (buf: Buffer, at: number, text: string) => { Buffer.from(text, 'latin1').copy(buf, at) }

  it('finds every action exactly once, including one that straddles a chunk boundary, and none twice', async () => {
    const buf = Buffer.alloc(3 * MIB + 5000, 0x20)
    put(buf, 10, '<< /S /Launch /F (first.pdf) >>')
    put(buf, MIB - 6, '<< /S /Launch /F (straddles.pdf) >>') // "/Launch" is cut by the 1 MiB boundary
    put(buf, 2 * MIB - 20, '<< /S /Launch /F (boundary2.pdf) >>')
    put(buf, 3 * MIB + 100, '<< /S /Launch /Win << /F (evil.exe) /P (x) >> >>')
    const file = path.join(dir, 'multi.pdf')
    await writeFile(file, buf)
    const r = await scanFileForLaunch(file)
    expect(r.ok).toBe(true)
    expect(r.launch_keywords).toBe(4)
    expect(r.actions.map((x: { target: string }) => x.target)).toEqual(['first.pdf', 'straddles.pdf', 'boundary2.pdf', 'evil.exe'])
    expect(verdictFor(r.actions)).toBe('blocked')
  })
  it('reports no action for a file without /Launch, and refuses to read an oversized or missing file', async () => {
    const clean = path.join(dir, 'clean.pdf')
    await writeFile(clean, Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF'))
    expect(await scanFileForLaunch(clean)).toMatchObject({ ok: true, launch_keywords: 0, actions: [] })
    expect(await scanFileForLaunch(clean, { maxBytes: 4 })).toMatchObject({ ok: false, reason: 'too_large' })
    expect(await scanFileForLaunch(path.join(dir, 'missing.pdf'))).toMatchObject({ ok: false })
  })
  it('resolves an action that points at a file-specification object, even when that object lies across a chunk boundary, and never trusts one it cannot find', async () => {
    const buf = Buffer.alloc(2 * MIB + 2000, 0x20)
    put(buf, 100, '470 0 obj<</F 471 0 R/S/Launch/NewWindow false>>\nendobj\n')
    put(buf, 300, '472 0 obj<</F 9999 0 R/S/Launch>>\nendobj\n') // 9999 does not exist
    put(buf, 500, '473 0 obj<</F 475 0 R/S/Launch>>\nendobj\n')
    put(buf, MIB - 8, '471 0 obj<</F(sibling.pdf)/Type/Filespec>>\nendobj\n') // "471 0 obj" is cut by the 1 MiB boundary
    put(buf, 2 * MIB + 10, '475 0 obj<</F(runme.exe)/Type/Filespec>>\nendobj\n')
    const file = path.join(dir, 'indirect.pdf')
    await writeFile(file, buf)
    const r = await scanFileForLaunch(file)
    expect(r.launch_keywords).toBe(3)
    expect(r.actions.map((a: { target: string | null }) => a.target)).toEqual(['sibling.pdf', null, 'runme.exe'])
    expect(r.actions[0].via_ref).toBe(true)
    expect(verdictFor([r.actions[0]])).toBe('reviewable') // a sibling PDF only; still never an approval
    expect(verdictFor(r.actions)).toBe('blocked') // one unresolved, one executable
    expect(verdictFor([r.actions[1]])).toBe('blocked')
  })
  it('a launch near the very end of a small file is found (the last chunk is processed completely)', async () => {
    const f = path.join(dir, 'end.pdf')
    await writeFile(f, Buffer.from('%PDF-1.4 ... << /S /Launch /F (tail.pdf)'))
    expect((await scanFileForLaunch(f)).actions.map((x: { target: string }) => x.target)).toEqual(['tail.pdf'])
  })
})
