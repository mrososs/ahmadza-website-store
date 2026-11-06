// Legacy data SOURCE abstraction + preflight. The importer never talks to the VPS: it reads a RESTORED COPY of the
// dump in an isolated, throw-away MariaDB bound to 127.0.0.1 with a read-only account.
//
//   docker run -d --name aawraq-legacy-restore -p 127.0.0.1:33306:3306 -e MARIADB_ROOT_PASSWORD=<throwaway> \
//     -e MARIADB_DATABASE=aawraq_legacy --network-alias legacy mariadb:10.6 --character-set-server=utf8mb4
//   (load the dump with the mariadb client inside the container, THEN create a read-only user:)
//   CREATE USER 'importer'@'%' IDENTIFIED BY '<throwaway>'; GRANT SELECT ON aawraq_legacy.* TO 'importer'@'%';
//
import { open, stat } from 'node:fs/promises'

/** Does the head of a file look like a MariaDB/MySQL dump? (An extension alone proves nothing.) */
export function looksLikeMysqlDump(head) {
  const t = Buffer.from(head).toString('utf8', 0, 4096)
  return /(MariaDB|MySQL) dump/i.test(t) || /^-- Server version/m.test(t) || /CREATE TABLE\s+`?\w+`?/i.test(t) || /^\s*INSERT INTO\s+`?\w+`?/im.test(t)
}

/** The legacy tables the importer reads (docs/legacy-audit/08). */
export const LEGACY_TABLES = [
  'site_infos', 'categories', 'makers', 'books', 'book_media', 'related_books', 'articles', 'pages',
  'users', 'orders', 'order_contents', 'online_payments', 'affiliate_orders', 'withdraws', 'withdraw_types',
  'request_books', 'comments', 'favourites', 'contact_us',
]

export function isLocalHost(h) { return h === '127.0.0.1' || h === 'localhost' || h === '::1' }

/**
 * Preflight: returns the exact list of missing inputs. Nothing runs unless `ready` is true.
 * @param {{ dumpPath?: string, dbHost?: string, dbName?: string, dbUser?: string, ownerAuthorised?: boolean, confirm?: string, sensitive?: boolean }} cfg
 */
export async function preflight(cfg) {
  const missing = []
  const notes = []
  if (!cfg.dumpPath) missing.push('MariaDB dump file path (--dump <file> or LEGACY_DUMP_PATH) — the production SQL dump has NOT been supplied (Q-A1)')
  else {
    try {
      const st = await stat(cfg.dumpPath)
      const fh = await open(cfg.dumpPath, 'r'); const buf = Buffer.alloc(4096); await fh.read(buf, 0, 4096, 0); await fh.close()
      if (st.size === 0) missing.push(`dump file ${cfg.dumpPath} is empty`)
      else if (!looksLikeMysqlDump(buf)) missing.push(`dump file ${cfg.dumpPath} does not look like a MariaDB/MySQL dump (no header / CREATE TABLE / INSERT found)`)
      else notes.push(`dump candidate ${cfg.dumpPath} (${st.size} bytes) passed the signature check`)
    } catch { missing.push(`dump file ${cfg.dumpPath} cannot be read`) }
  }
  if (!cfg.dbHost) missing.push('restored read-only MariaDB (LEGACY_DB_HOST / LEGACY_DB_NAME / LEGACY_DB_USER / LEGACY_DB_PASSWORD) — restore the dump into an isolated local container first')
  else if (!isLocalHost(cfg.dbHost)) missing.push(`LEGACY_DB_HOST must be local (127.0.0.1); got ${cfg.dbHost}. The importer never connects to the production VPS`)
  if (cfg.sensitive && !(cfg.ownerAuthorised && cfg.confirm === OWNER_CONFIRMATION)) {
    missing.push(`sensitive phases (customers, orders, payouts, contact messages, contributor documents) need --owner-authorised and --confirm "${OWNER_CONFIRMATION}"`)
  }
  return { ready: missing.length === 0, missing, notes }
}
export const OWNER_CONFIRMATION = 'I CONFIRM THE OWNER AUTHORISED IMPORTING CUSTOMER AND FINANCIAL DATA'

/** In-memory source (tests, fixtures). @param {Record<string, object[]>} tables */
export function createFixtureSource(tables) {
  return {
    kind: 'fixture',
    async tables() { return Object.keys(tables) },
    async count(t) { return (tables[t] ?? []).length },
    async rows(t) { return tables[t] ?? [] },
  }
}

/** Read-only MariaDB source. `mysql2` is loaded lazily so the repository needs no DB-driver dependency until a dump exists. */
export async function createMariaDbSource({ host, port = 3306, user, password, database }) {
  if (!isLocalHost(host)) throw new Error(`refusing non-local legacy DB host ${host}`)
  let mysql
  try { mysql = await import('mysql2/promise') } catch { throw new Error('mysql2 is not installed. Run `npm i -D mysql2` once the dump is restored into the local throw-away container.') }
  const conn = await mysql.createConnection({ host, port, user, password, database, charset: 'utf8mb4', dateStrings: true, multipleStatements: false })
  await conn.query('SET SESSION TRANSACTION READ ONLY')
  return {
    kind: 'mariadb',
    async tables() { const [r] = await conn.query('SHOW TABLES'); return r.map((x) => Object.values(x)[0]) },
    async count(t) { const [r] = await conn.query('SELECT COUNT(*) AS c FROM ??', [t]); return Number(r[0].c) },
    async rows(t) { const [r] = await conn.query('SELECT * FROM ??', [t]); return r },
    async close() { await conn.end() },
  }
}
