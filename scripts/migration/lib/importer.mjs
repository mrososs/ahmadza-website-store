// Legacy -> Supabase importer (orchestration). Idempotent: every phase is an upsert / insert-if-absent keyed by legacy ids,
// mapped through public.legacy_id_map. Rejects go to public.migration_rejects and the run continues.
// dryRun = every transform and validation runs, but NOTHING is written (no auth user, no row, no storage object).
import * as T from './transform.mjs'
import { linkMedia } from './link.mjs'
import { rewriteEditorImages } from './transform.mjs'
import { sumDecimals, differsMoreThanHalfCent, parseMoney } from './money.mjs'

const chunk = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n))
const must = ({ data, error }) => { if (error) throw error; return data }

export const CATALOG_PHASES = ['settings', 'categories', 'makers', 'books', 'book_media', 'related_books', 'articles', 'pages']
export const SENSITIVE_PHASES = ['users', 'orders', 'affiliates', 'comments', 'favourites', 'contact_messages', 'contributor_requests', 'payout_methods']

/**
 * @param {{ source: any, db: any, sanitize?: (h:string)=>string, dryRun?: boolean, phases?: string[], includePii?: boolean,
 *           grantTestEntitlements?: boolean, markDemo?: boolean, editorImageResolver?: (file:string)=>string|null }} o
 */
export async function runImport(o) {
  const state = {}
  try { return await runImportInner(o, state) } catch (e) {
    // never leave a run looking "in progress" after a crash
    if (state.runId && !o.dryRun) await o.db.from('migration_runs').update({ finished_at: new Date().toISOString(), notes: `FAILED: ${String(e.message ?? e).slice(0, 500)}` }).eq('id', state.runId)
    throw e
  }
}

async function runImportInner(o, state) {
  const { source, db, dryRun = false, sanitize = (h) => h, includePii = false, markDemo = false } = o
  const phases = o.phases ?? CATALOG_PHASES
  const rejects = []
  const warnings = []
  const counts = {}
  const tableCount = {}
  const idMap = { categories: new Map(), makers: new Map(), books: new Map(), users: new Map(), orders: new Map(), commissions: new Map() }
  let runId = null
  if (!dryRun) { runId = must(await db.from('migration_runs').insert({ kind: phases.join(','), dry_run: false }).select('id').single()).id; state.runId = runId }

  const rewriteImages = (h) => (o.editorImageResolver ? rewriteEditorImages(h, o.editorImageResolver) : { html: h, unresolved: [] })
  const ctxT = { sanitize, rewriteImages }
  const demo = markDemo ? { is_demo: true } : {}
  const bump = (k, n = 1) => { counts[k] = (counts[k] ?? 0) + n }
  const reject = (entity, legacyId, reason, payload) => { rejects.push({ run_id: runId, entity, legacy_id: legacyId == null ? null : String(legacyId), reason, payload: payload ?? null }); bump(`${entity}.rejected`) }
  const has = async (t) => (await source.tables()).includes(t)
  const rowsOf = async (t) => { if (!(await has(t))) { warnings.push(`source table ${t} is missing`); return [] } const r = await source.rows(t); tableCount[t] = r.length; return r }

  async function upsert(table, entity, rows, conflict = 'legacy_id') {
    if (!rows.length) return new Map()
    const map = new Map()
    if (dryRun) { rows.forEach((r, i) => map.set(r[conflict], `dry-${i}`)); bump(`${entity}.would_upsert`, rows.length); return map }
    for (const part of chunk(rows, 200)) {
      const data = must(await db.from(table).upsert(part, { onConflict: conflict, defaultToNull: false }).select(`id,${conflict}`))
      data.forEach((r) => map.set(r[conflict], r.id))
      must(await db.from('legacy_id_map').upsert(data.map((r) => ({ entity, legacy_id: String(r[conflict]), new_id: String(r.id), run_id: runId })), { onConflict: 'entity,legacy_id' }))
    }
    bump(`${entity}.imported`, rows.length)
    return map
  }
  const resolved = (map, legacy) => (legacy == null ? undefined : map.get(legacy))

  // ---- non-sensitive catalog & content ---------------------------------------------------------------------------
  if (phases.includes('settings')) {
    const [r] = await rowsOf('site_infos')
    if (r) {
      const m = T.mapSiteInfo(r)
      warnings.push(...m.warnings.map((w) => `site_infos: ${w}`))
      if (!dryRun) must(await db.from('site_settings').update(m.row).eq('id', 1))
      bump('settings.imported')
    } else bump('settings.missing')
  }
  if (phases.includes('categories')) {
    const rows = []
    for (const r of await rowsOf('categories')) { const m = T.mapCategory(r); if (m.ok) rows.push({ ...m.row, ...demo }); else reject('categories', r.id, m.reason, r) }
    idMap.categories = await upsert('categories', 'categories', rows)
  }
  if (phases.includes('makers')) {
    const rows = []
    for (const r of await rowsOf('makers')) { const m = T.mapMaker(r, ctxT); if (m.ok) { rows.push({ ...m.row, ...demo }); m.unresolvedImages.forEach((f) => warnings.push(`maker ${r.id}: unresolved editor image ${f}`)) } else reject('makers', r.id, m.reason, r) }
    idMap.makers = await upsert('makers', 'makers', rows)
  }
  if (phases.includes('books')) {
    const mapped = []
    for (const r of await rowsOf('books')) { const m = T.mapBook(r, ctxT); if (m.ok) { mapped.push(m); m.warnings.forEach((w) => warnings.push(`book ${r.id}: ${w}`)) } else reject('books', r.id, m.reason, r) }
    idMap.books = await upsert('books', 'books', mapped.map((m) => ({ ...m.row, ...demo })))
    if (!dryRun) {
      for (const m of mapped) {
        const id = idMap.books.get(m.row.legacy_id)
        const cats = [...new Set(m.categoryLegacyIds.map((c) => resolved(idMap.categories, c)))].filter(Boolean)
        const unresolvedCats = m.categoryLegacyIds.filter((c) => !idMap.categories.has(c))
        if (unresolvedCats.length) warnings.push(`book ${m.row.legacy_id}: category ids ${unresolvedCats.join(',')} not found`)
        must(await db.from('book_categories').delete().eq('book_id', id))
        must(await db.from('book_makers').delete().eq('book_id', id))
        must(await db.from('book_tags').delete().eq('book_id', id))
        if (cats.length) must(await db.from('book_categories').insert(cats.map((category_id) => ({ book_id: id, category_id }))))
        const mk = m.makers.map((x) => ({ book_id: id, maker_id: resolved(idMap.makers, x.legacy_maker_id), role: x.role })).filter((x) => x.maker_id)
        if (mk.length) must(await db.from('book_makers').insert(mk))
        if (m.tags.length) must(await db.from('book_tags').insert(m.tags.map((tag) => ({ book_id: id, tag }))))
      }
    }
  }
  if (phases.includes('book_media')) {
    const internal = []
    for (const r of await rowsOf('book_media')) {
      const m = T.mapBookMedia(r)
      if (!m.ok) { reject('book_media', r.id, m.reason, r); continue }
      const bookId = resolved(idMap.books, m.legacyBookId)
      if (!bookId) { reject('book_media', r.id, `book ${m.legacyBookId} not imported`, r); continue }
      m.warnings.forEach((w) => warnings.push(`book_media ${r.id}: ${w}`))
      if (dryRun) { bump('book_media.would_import'); continue }
      if (m.row.is_external) {
        const ex = must(await db.from('book_media').select('id').eq('legacy_book_media_id', m.row.legacy_book_media_id).maybeSingle())
        if (!ex) must(await db.from('book_media').insert({ book_id: bookId, ...m.row })); bump('book_media.imported')
      } else internal.push({ m, bookId })
    }
    if (!dryRun && internal.length) {
      const report = await linkMedia(db, internal.map(({ m, bookId }) => ({
        legacy_path: m.row.legacy_path, book_id: bookId, visibility: m.row.visibility, name: m.row.name, kind: m.row.kind,
        sort_order: m.row.sort_order, page_count: m.row.page_count, legacy_book_media_id: m.row.legacy_book_media_id,
      })))
      bump('book_media.linked_from_staging', report.linked.length)
      for (const s of report.skipped) {
        if (/already imported/.test(s.reason)) continue
        // not staged / not in inventory => keep a placeholder row so the legacy record is not lost, and report it
        const { m, bookId } = internal.find((x) => x.m.row.legacy_path === s.legacy_path)
        const ex = must(await db.from('book_media').select('id').eq('legacy_book_media_id', m.row.legacy_book_media_id).maybeSingle())
        if (!ex) must(await db.from('book_media').insert({ book_id: bookId, ...m.row, legacy_download_count: m.row.legacy_download_count }))
        warnings.push(`missing_media: ${s.legacy_path} — ${s.reason}`); bump('book_media.missing_or_pending')
      }
      report.failed.forEach((f) => reject('book_media', f.legacy_path, f.error))
    }
  }
  if (phases.includes('related_books')) {
    const pairs = new Set()
    for (const r of await rowsOf('related_books')) {
      const a = Number(r.book_id), b = Number(r.related_id)
      const ia = idMap.books.get(a), ib = idMap.books.get(b)
      if (!ia || !ib || ia === ib) { warnings.push(`related_books ${a}-${b}: dangling or self relation dropped`); continue }
      pairs.add(ia < ib ? `${ia}:${ib}` : `${ib}:${ia}`)
    }
    if (!dryRun && pairs.size) must(await db.from('book_relations').upsert([...pairs].map((p) => { const [x, y] = p.split(':'); return { book_id: Number(x), related_id: Number(y) } }), { onConflict: 'book_id,related_id', ignoreDuplicates: true }))
    bump('related_books.imported', pairs.size)
  }
  if (phases.includes('articles')) {
    const rows = []
    for (const r of await rowsOf('articles')) { const m = T.mapArticle(r, ctxT); if (m.ok) { if (m.adminAuthored) rows.push({ ...m.row, ...demo }); else bump('articles.skipped_user_authored') } else reject('articles', r.id, m.reason, r) }
    await upsert('articles', 'articles', rows)
  }
  if (phases.includes('pages')) {
    const mapped = []
    for (const r of await rowsOf('pages')) { const m = T.mapPage(r, ctxT); if (m.ok) mapped.push(m.row); else reject('pages', r.id, m.reason, r) }
    const { rows, collisions } = T.resolvePageSlugs(mapped)
    collisions.forEach((c) => warnings.push(`page slug collision "${c.slug}" (legacy ids ${c.legacy_ids.join(',')}): live row kept, others suffixed`))
    await upsert('pages', 'pages', rows.map((r) => ({ ...r, ...demo })))
  }

  // ---- sensitive phases (only with explicit owner authorisation; enforced by the CLI preflight) -------------------
  const wantsSensitive = SENSITIVE_PHASES.some((p) => phases.includes(p))
  if (wantsSensitive && phases.includes('users')) await importUsers()
  if (wantsSensitive && phases.includes('orders')) await importOrders()
  if (wantsSensitive && phases.includes('affiliates')) await importAffiliates()
  if (wantsSensitive) await importMisc()

  async function ensureAuthUser(email, name, { confirmed, login }) {
    const { data, error } = await db.auth.admin.createUser({
      email, email_confirm: confirmed, user_metadata: { display_name: name },
      ...(login ? {} : { ban_duration: '876000h' }), // soft-deleted legacy users get no usable login; no password is ever set
    })
    if (error) {
      const found = (await db.auth.admin.listUsers({ page: 1, perPage: 1000 })).data?.users.find((u) => u.email === email)
      if (!found) throw error
      return found.id
    }
    return data.user.id
  }
  async function importUsers() {
    const rows = await rowsOf('users')
    const existing = new Map(dryRun ? [] : must(await db.from('profiles').select('id,legacy_user_id').not('legacy_user_id', 'is', null)).map((p) => [p.legacy_user_id, p.id]))
    for (const r of rows) {
      const m = T.mapUser(r, { includePii })
      if (!m.ok) { reject('users', r.id, m.reason, { id: r.id }); continue }
      if (m.guestCreated) warnings.push(`user ${r.id}: guest-checkout account — flagged require_password_reset, plaintext default_password discarded`)
      if (dryRun) { bump('users.would_import'); idMap.users.set(m.row.legacy_user_id, `dry-${r.id}`); continue }
      let id = existing.get(m.row.legacy_user_id)
      if (!id) id = await ensureAuthUser(m.auth.email, m.row.display_name, { confirmed: m.auth.email_confirmed, login: m.auth.create_login })
      must(await db.from('profiles').update(m.row).eq('id', id))
      must(await db.from('legacy_id_map').upsert({ entity: 'users', legacy_id: String(m.row.legacy_user_id), new_id: id, run_id: runId }, { onConflict: 'entity,legacy_id' }))
      idMap.users.set(m.row.legacy_user_id, id); bump('users.imported')
    }
  }
  async function placeholderBuyer() {
    if (dryRun) return 'dry-placeholder'
    const id = await ensureAuthUser('legacy-unknown-buyer@legacy.invalid', 'مشتري قديم (غير معروف)', { confirmed: false, login: false })
    must(await db.from('profiles').update({ display_name: 'مشتري قديم (غير معروف)', status: 'banned' }).eq('id', id))
    return id
  }
  async function importOrders() {
    const orders = [], mappedOrders = []
    for (const r of await rowsOf('orders')) { const m = T.mapOrder(r); if (m.ok) mappedOrders.push(m); else reject('orders', r.id, m.reason, { id: r.id, amount: r.amount }) }
    const itemsByOrder = new Map()
    const items = []
    for (const r of await rowsOf('order_contents')) { const m = T.mapOrderItem(r); if (m.ok) { items.push(m); itemsByOrder.set(m.orderLegacyId, [...(itemsByOrder.get(m.orderLegacyId) ?? []), m]) } else reject('order_contents', r.id, m.reason, { id: r.id }) }
    const existing = dryRun ? new Set() : new Set(must(await db.from('orders').select('legacy_order_id').not('legacy_order_id', 'is', null)).map((x) => x.legacy_order_id))
    let placeholder = null
    for (const m of mappedOrders) {
      if (existing.has(m.row.legacy_order_id)) { bump('orders.already_present'); continue }
      let uid = resolved(idMap.users, m.userLegacyId)
      if (!uid) { placeholder ??= await placeholderBuyer(); uid = placeholder; warnings.push(`order ${m.row.legacy_order_id}: buyer ${m.userLegacyId ?? 'NULL'} not found — attached to the "legacy unknown buyer" placeholder`) }
      if (dryRun) { bump('orders.would_import'); idMap.orders.set(m.row.legacy_order_id, `dry-${m.row.legacy_order_id}`); orders.push(m.row); continue }
      const aff = resolved(idMap.users, m.affiliateLegacyId)
      const o = must(await db.from('orders').insert({ ...m.row, user_id: uid, affiliate_id: aff ?? null }).select('id,legacy_order_id').single())
      idMap.orders.set(o.legacy_order_id, o.id); orders.push(m.row)
      const lines = (itemsByOrder.get(m.row.legacy_order_id) ?? []).map((i) => {
        const bookId = resolved(idMap.books, i.bookLegacyId) ?? null
        return { order_id: o.id, book_id: bookId, legacy_book_id: i.bookLegacyId, title_snapshot: bookId ? '' : '(كتاب محذوف)', ...i.row }
      })
      if (lines.length) {
        const bookTitles = new Map(must(await db.from('books').select('id,title').in('id', lines.map((l) => l.book_id).filter(Boolean))).map((b) => [b.id, b.title]))
        lines.forEach((l) => { if (l.book_id) l.title_snapshot = bookTitles.get(l.book_id) ?? '' })
        must(await db.from('order_items').insert(lines))
      }
      bump('orders.imported')
    }
    // entitlements (derived; test-mode orders excluded unless explicitly allowed)
    const flat = mappedOrders.map((m) => ({ ...m.row, userLegacyId: m.userLegacyId }))
    const ents = T.deriveEntitlements(flat, items, { grantTest: !!o.grantTestEntitlements })
    bump('entitlements.derived', ents.length)
    if (!dryRun && ents.length) {
      const rows = ents.map((e) => ({ user_id: resolved(idMap.users, e.userLegacyId), book_id: resolved(idMap.books, e.bookLegacyId), is_test: e.is_test })).filter((e) => e.user_id && e.book_id)
      for (const part of chunk(rows, 200)) must(await db.from('entitlements').upsert(part, { onConflict: 'user_id,book_id', ignoreDuplicates: true }))
    }
  }
  async function importAffiliates() {
    const ordersMode = new Map(must(dryRun ? { data: [], error: null } : await db.from('orders').select('legacy_order_id,mode,id')).map((x) => [x.legacy_order_id, x]))
    for (const r of await rowsOf('affiliate_orders')) {
      const ord = ordersMode.get(Number(r.order_id))
      const m = T.mapAffiliateOrder(r, ord?.mode)
      if (!m.ok) { reject('affiliate_orders', r.id, m.reason, { id: r.id }); continue }
      if (dryRun) { bump('affiliate_orders.would_import'); continue }
      const affId = resolved(idMap.users, m.affiliateLegacyId)
      if (!ord || !affId) { reject('affiliate_orders', r.id, 'order or affiliate not imported', { id: r.id }); continue }
      const c = must(await db.from('affiliate_commissions').upsert({ ...m.row, order_id: ord.id, affiliate_id: affId }, { onConflict: 'legacy_id' }).select('id').single())
      const has = must(await db.from('affiliate_ledger').select('id').eq('commission_id', c.id).limit(1))
      if (!has.length) must(await db.from('affiliate_ledger').insert({ affiliate_id: affId, entry_type: 'commission', amount: m.row.amount, currency: m.row.currency, available_at: m.row.available_at, commission_id: c.id, is_test: m.row.is_test, memo: 'legacy import' }))
      bump('affiliate_orders.imported')
    }
    for (const r of await rowsOf('withdraws')) {
      const m = T.mapWithdraw(r)
      if (!m.ok) { reject('withdraws', r.id, m.reason, { id: r.id }); continue }
      if (dryRun) { bump('withdraws.would_import'); continue }
      const affId = resolved(idMap.users, m.affiliateLegacyId)
      if (!affId) { reject('withdraws', r.id, 'affiliate not imported', { id: r.id }); continue }
      const w = must(await db.from('withdrawal_requests').upsert({ ...m.row, affiliate_id: affId }, { onConflict: 'legacy_id' }).select('id').single())
      if (m.row.status !== 'rejected' && !must(await db.from('affiliate_ledger').select('id').eq('withdrawal_id', w.id).limit(1)).length) {
        must(await db.from('affiliate_ledger').insert({ affiliate_id: affId, entry_type: 'withdrawal_hold', amount: `-${m.row.amount}`, currency: m.row.currency, withdrawal_id: w.id, memo: 'legacy import' }))
      }
      bump('withdraws.imported')
    }
  }
  async function importMisc() {
    if (phases.includes('comments')) for (const r of await rowsOf('comments')) {
      const m = T.mapComment(r); if (!m.ok) { reject('comments', r.id, m.reason); continue }
      const u = resolved(idMap.users, m.userLegacyId), b = resolved(idMap.books, m.bookLegacyId)
      if (!u || !b) { reject('comments', r.id, 'user or book not imported'); continue }
      if (!dryRun) must(await db.from('comments').upsert({ ...m.row, user_id: u, book_id: b }, { onConflict: 'legacy_id' }))
      bump('comments.imported')
    }
    if (phases.includes('favourites')) for (const r of await rowsOf('favourites')) {
      const m = T.mapFavourite(r); if (!m.ok) { reject('favourites', r.id, m.reason); continue }
      const u = resolved(idMap.users, m.userLegacyId), b = m.target === 'books' ? resolved(idMap.books, m.targetLegacyId) : null
      if (!u || (m.target === 'books' && !b) || m.target === 'articles') { warnings.push(`favourite ${r.id}: dropped (${m.target === 'articles' ? 'article favourites are not migrated' : 'target/user missing'})`); continue }
      if (!dryRun) must(await db.from('favourites').upsert({ user_id: u, book_id: b }, { onConflict: 'user_id,book_id', ignoreDuplicates: true }))
      bump('favourites.imported')
    }
    if (phases.includes('contact_messages')) for (const r of await rowsOf('contact_us')) {
      const m = T.mapContact(r); if (!m.ok) { reject('contact_us', r.id, m.reason); continue }
      if (!dryRun) must(await db.from('contact_messages').insert(m.row)); bump('contact_messages.imported')
    }
    if (phases.includes('payout_methods')) for (const r of await rowsOf('withdraw_types')) {
      const m = T.mapWithdrawType(r); if (!m.ok) { reject('withdraw_types', r.id, m.reason); continue }
      const a = resolved(idMap.users, m.affiliateLegacyId); if (!a) { reject('withdraw_types', r.id, 'affiliate not imported'); continue }
      if (!dryRun) must(await db.from('payout_methods').upsert({ affiliate_id: a, ...m.row }, { onConflict: 'affiliate_id,kind' })); bump('payout_methods.imported')
    }
    if (phases.includes('contributor_requests')) for (const r of await rowsOf('request_books')) {
      const m = T.mapRequestBook(r, { includeSensitive: true }); if (!m.ok) { reject('request_books', r.id, m.reason); continue }
      const u = resolved(idMap.users, m.userLegacyId); if (!u) { reject('request_books', r.id, 'user not imported'); continue }
      warnings.push(`request_book ${r.id}: uploaded documents/files are NOT in the recovered archive (private-sensitive bucket stays empty)`)
      if (!dryRun) must(await db.from('contributor_requests').upsert({ ...m.row, user_id: u }, { onConflict: 'legacy_id' })); bump('request_books.imported')
    }
  }

  // ---- reconciliation (V1–V10 skeleton) --------------------------------------------------------------------------
  const reconciliation = await reconcile({ source, db, dryRun, counts, rejects, tableCount, phases })
  if (!dryRun) {
    if (rejects.length) for (const part of chunk(rejects, 200)) must(await db.from('migration_rejects').insert(part))
    must(await db.from('migration_runs').update({ finished_at: new Date().toISOString(), counts: { ...counts, reconciliation }, notes: warnings.slice(0, 50).join('\n') }).eq('id', runId))
  }
  return { runId, dryRun, counts, rejects, warnings, reconciliation }
}

/** V1 (row counts) + V4/V8 helpers. Remaining checks are listed as `todo` until a real source exists. */
async function reconcile({ source, db, dryRun, counts, rejects, tableCount, phases }) {
  const rej = (e) => rejects.filter((r) => r.entity === e).length
  const v1 = {}
  for (const [legacy, target] of [['categories', 'categories'], ['makers', 'makers'], ['books', 'books'], ['book_media', 'book_media'], ['articles', 'articles'], ['pages', 'pages'], ['users', 'users'], ['orders', 'orders']]) {
    if (tableCount[legacy] == null) continue
    const imported = (counts[`${target}.imported`] ?? 0) + (counts[`${target}.would_import`] ?? 0) + (counts[`${target}.would_upsert`] ?? 0) + (counts[`${target}.already_present`] ?? 0) + (counts[`${target}.linked_from_staging`] ?? 0) + (counts[`${target}.missing_or_pending`] ?? 0)
    const excluded = (counts[`${target}.skipped_user_authored`] ?? 0)
    v1[legacy] = { legacy_rows: tableCount[legacy], imported, rejected: rej(legacy), excluded, balanced: tableCount[legacy] === imported + rej(legacy) + excluded }
  }
  const out = { V1_row_counts: v1, V2_V3_V5_V6_V7_V9_V10: 'todo: needs a populated target (see docs/implementation/07-historical-data-import.md)', V8: null, source_kind: source.kind }
  if (phases.includes('orders') && source.kind && tableCount.orders != null) {
    const rows = await source.rows('orders')
    const parsed = rows.map((r) => parseMoney(r.amount)).filter((p) => p.ok)
    out.V8 = { legacy_order_sum_by_exact_decimal: sumDecimals(parsed.map((p) => p.value)), unparsable: rows.length - parsed.length }
    if (!dryRun) {
      const sum = must(await db.from('orders').select('total_amount,legacy_raw_amount').not('legacy_order_id', 'is', null))
      out.V8.target_sum = sumDecimals(sum.map((s) => String(s.total_amount)))
      out.V8.equal_for_imported = !differsMoreThanHalfCent(out.V8.legacy_order_sum_by_exact_decimal, out.V8.target_sum)
    }
  }
  return out
}
