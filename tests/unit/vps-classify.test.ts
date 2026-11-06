// The inspection classifier must rank the recovery paths correctly. Fixtures are SYNTHETIC reports produced by running
// scripts/vps/readonly-inspect.sh in a Linux container against a fake AAWRAQ server (see tests/fixtures/vps-inspection).
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const script = new URL('../../scripts/vps/classify-inspection.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const fixture = (n: string) => new URL(`../fixtures/vps-inspection/scenario-${n}.txt`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const fixtureFile = (name: string) => new URL(`../fixtures/vps-inspection/${name}.txt`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
type Report = { recommended_path: string; ranked_paths: { id: string; unsafe?: boolean; why: string }[]; database: Record<string, unknown>; gate: { verdict: string; blocking_findings: string[] } }
const run = (files: string[]) => {
  const r = spawnSync(process.execPath, [script, ...files, '--json'], { encoding: 'utf8' })
  expect(r.status, r.stderr).toBe(0)
  return JSON.parse(r.stdout) as Report
}
const classify = (n: string) => run([fixture(n)])
/** the full inspection (a physical datadir that looks intact) plus the minimal MariaDB check, which wins where both print a FLAG */
const withMinimal = (minimal: string) => run([fixture('b'), fixtureFile(minimal)])

describe('classify-inspection.mjs', () => {
  it('A: an existing backup archive wins; the physical files remain the fallback', () => {
    const j = classify('a')
    expect(j.recommended_path).toBe('A')
    expect(j.ranked_paths.map((p) => p.id)).toEqual(['A', 'B2', 'B3'])
  })
  it('B2: no dump, MariaDB not running, files intact -> recover the physical copy; recommends the matching image', () => {
    const j = classify('b')
    expect(j.recommended_path).toBe('B2')
    expect(j.database.recommended_recovery_image).toBe('mariadb:10.6.28') // the EXACT version, never just the series
    expect(j.database.recommended_source_version).toBe('10.6.28')
    expect(j.database.mariadb_version).toBe('10.6.28')
  })
  it('a unit stuck in DEACTIVATING with D-state threads and changing files is NOT a copy source: B2 is never recommended', () => {
    const j = withMinimal('minimal-deactivating')
    expect(j.recommended_path).not.toBe('B2')
    expect(j.ranked_paths.map((p) => p.id)).not.toContain('B2')
    const unsafe = j.ranked_paths.find((p) => p.id === 'B2-UNSAFE')
    expect(unsafe?.unsafe).toBe(true)
    expect(unsafe?.why).toMatch(/deactivating/)
    expect(unsafe?.why).toMatch(/D state/)
    expect(unsafe?.why).toMatch(/changed while they were being sampled/)
    expect(unsafe?.why).toMatch(/do not restart, kill or signal/i)
    expect(j.ranked_paths.at(-1)?.id).toBe('B2-UNSAFE') // an unsafe path is never ranked above a safe one
    expect(j.recommended_path).toBe('B3') // a provider backup restored to a NEW server is the safe route
    expect(j.database.datadir_consistent_copy_source).toBe(false)
    expect(j.database.mariadb_unit_state).toBe('deactivating/stop-sigterm')
    expect(j.database.threads_in_d_state).toBe(3)
  })
  it('a cleanly stopped MariaDB whose datadir is not changing IS a copy source (B2), with the exact version for recovery', () => {
    const j = withMinimal('minimal-stopped-static')
    expect(j.recommended_path).toBe('B2')
    expect(j.ranked_paths.find((p) => p.id === 'B2')?.why).toMatch(/-SourceVersion 10\.6\.28/)
    expect(j.database.datadir_consistent_copy_source).toBe(true)
    expect(j.database.redo_layout).toBe('classic_ib_logfile')
  })
  it('a stopped unit whose files are still changing (something else is writing) is not a copy source either', () => {
    const j = withMinimal('minimal-stopped-changing')
    expect(j.ranked_paths.map((p) => p.id)).not.toContain('B2')
    expect(j.ranked_paths.find((p) => p.id === 'B2-UNSAFE')?.why).toMatch(/changed while they were being sampled/)
    expect(j.database.datadir_changing).toBe('yes')
  })
  it('with nothing safe to use, the answer is to escalate for a provider backup, never to copy the unstable datadir', () => {
    const only = run([fixtureFile('minimal-deactivating')])
    expect(only.recommended_path).toBe('C')
    expect(only.ranked_paths.find((p) => p.id === 'C')?.why).toMatch(/NEW server, never in place/)
  })
  it('C: nothing usable -> escalate', () => {
    expect(classify('c').recommended_path).toBe('C')
  })
  it('STOP: encryption settings found -> stop before copying anything', () => {
    const j = classify('e')
    expect(j.recommended_path).toBe('STOP')
    expect(j.database.encryption_hint).toBe('yes')
  })
  it('the deployment gate flags planted script-like files and never declares a host clean', () => {
    const j = classify('a')
    expect(j.gate.verdict).toMatch(/^NO-GO/)
    expect(j.gate.blocking_findings.join(' ')).toMatch(/script-like file/)
  })
})
