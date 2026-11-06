// The inspection classifier must rank the recovery paths correctly. Fixtures are SYNTHETIC reports produced by running
// scripts/vps/readonly-inspect.sh in a Linux container against a fake AAWRAQ server (see tests/fixtures/vps-inspection).
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const script = new URL('../../scripts/vps/classify-inspection.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const fixture = (n: string) => new URL(`../fixtures/vps-inspection/scenario-${n}.txt`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const classify = (n: string) => {
  const r = spawnSync(process.execPath, [script, fixture(n), '--json'], { encoding: 'utf8' })
  expect(r.status, r.stderr).toBe(0)
  return JSON.parse(r.stdout) as { recommended_path: string; ranked_paths: { id: string }[]; database: Record<string, unknown>; gate: { verdict: string; blocking_findings: string[] } }
}

describe('classify-inspection.mjs', () => {
  it('A: an existing backup archive wins; the physical files remain the fallback', () => {
    const j = classify('a')
    expect(j.recommended_path).toBe('A')
    expect(j.ranked_paths.map((p) => p.id)).toEqual(['A', 'B2', 'B3'])
  })
  it('B2: no dump, MariaDB not running, files intact -> recover the physical copy; recommends the matching image', () => {
    const j = classify('b')
    expect(j.recommended_path).toBe('B2')
    expect(j.database.recommended_recovery_image).toBe('mariadb:10.6')
    expect(j.database.mariadb_version).toBe('10.6.28')
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
