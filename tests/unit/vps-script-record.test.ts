// The owner verifies the scripts on the VPS by SHA-256 against docs/implementation/VPS_INSPECT_SCRIPT_CHANGES.md. If a script changes and the
// record is not regenerated, the owner would be told to distrust a good file (or trust a changed one). This test makes that drift impossible.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (rel: string) => readFileSync(new URL(`../../${rel}`, import.meta.url))
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')
const record = read('docs/implementation/VPS_INSPECT_SCRIPT_CHANGES.md').toString('utf8')

describe('VPS script change record', () => {
  for (const script of ['scripts/vps/minimal-mariadb-check.sh', 'scripts/vps/readonly-inspect.sh']) {
    it(`records the current SHA-256 of ${script}`, () => {
      const bytes = read(script)
      expect(bytes.includes(13), 'the script must use LF line endings (a CR byte makes bash fail on the server)').toBe(false)
      expect(record, `regenerate the record: the hash of ${script} changed`).toContain(sha(bytes))
    })
  }
  it('both scripts stay strictly read-only: no write, delete, service-control or permission command', () => {
    // Commands that would change the server. Redirects to the caller's own output file are the only writes allowed (and neither script has one).
    const forbidden = /(^|[\s;&|(`])(rm|mv|cp|chmod|chown|chattr|kill|killall|pkill|truncate|dd|mkfs|mount|umount|useradd|passwd|iptables|firewall-cmd\s+--(add|remove|reload)|systemctl\s+(start|stop|restart|reload|enable|disable|mask|kill|daemon-reload)|service\s+\S+\s+(start|stop|restart)|mysqldump|mariadb-dump|mariabackup|rsync|scp|wget|curl|yum|dnf|rpm\s+-[iUe]|pip|npm)\b/m
    for (const script of ['scripts/vps/minimal-mariadb-check.sh', 'scripts/vps/readonly-inspect.sh']) {
      const code = read(script).toString('utf8').split('\n').filter((l) => !l.trim().startsWith('#') && !/^\s*(echo|sec)\b.*"/.test(l) || /\$\(/.test(l))
      // a database CLIENT invoked as a command (start of a command, after a pipe, semicolon or &&), not the word "mariadb" as a unit name or argument
      const dbClient = /(^|[;&|(]\s*|\bxargs\s+)(mysql|mariadb)\s+[-<]/m
      const strip = (l: string) => l.replace(/'[^']*'/g, "''").replace(/"[^"$`]*"/g, '""')
      const hits = code.filter((l) => forbidden.test(strip(l)) || dbClient.test(strip(l).trim()))
      expect(hits, `${script} contains a command that is not read-only`).toEqual([])
    }
  })
  it('the minimal check never contacts MariaDB with SQL and only pings once', () => {
    const src = read('scripts/vps/minimal-mariadb-check.sh').toString('utf8').split('\n').filter((l) => !l.trim().startsWith('#')).join('\n')
    expect((src.match(/mysqladmin\s+ping/g) ?? []).length).toBe(1)
    expect(src).not.toMatch(/\b(mysql|mariadb)\s+-/)
    expect(src).not.toMatch(/SELECT |SHOW |INSERT |UPDATE |DELETE /)
  })
})
