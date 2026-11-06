// PURE legacy -> target row transforms (docs/legacy-audit/14). No I/O, no database, no randomness.
// Every mapper returns { ok:true, row, ... , warnings[] } or { ok:false, reason }. Rejects are NEVER coerced:
// they are written to migration_rejects by the loader. Historical money is copied as recorded (raw string kept).
import { parseMoney } from './money.mjs'

const ok = (row, extra = {}, warnings = []) => ({ ok: true, row, warnings, ...extra })
const no = (reason) => ({ ok: false, reason })
// Legacy timestamps are naive; the Laravel app timezone is [Unknown] (docs/16) so they are read as UTC — assumption documented.
const iso = (v) => v instanceof Date ? v.toISOString() : (v == null || v === '' || String(v).startsWith('0000-00-00') ? null : new Date(String(v).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(v)) ? '' : 'Z')).toISOString())
const int = (v) => (v === null || v === undefined || v === '' ? null : Number.parseInt(String(v), 10))
const str = (v) => (v == null ? null : String(v))
const bool = (v) => v === true || v === 1 || v === '1'

/** Parse a JSON-in-varchar column. Invalid JSON is reported, never guessed. */
export function parseJsonColumn(raw) {
  if (raw == null || raw === '') return { ok: true, value: [] }
  try { const v = JSON.parse(raw); return { ok: true, value: Array.isArray(v) ? v : [v] } } catch { return { ok: false, raw } }
}

// ---- status / enum maps -------------------------------------------------------------------------------------------
export const USER_STATUS = { 0: 'review', 1: 'active', 2: 'banned' }
export const BOOK_STATUS = { 0: 'draft', 1: 'published', 2: 'coming_soon' }
export const WITHDRAW_STATUS = { 2: 'pending', 1: 'paid', 0: 'rejected' } // legacy boolean column holding 3 states
export const REQUEST_STATUS = { 0: 'pending', 1: 'approved', 2: 'declined' }
export const mapMediaVisibility = (isFree) => (isFree === 1 || isFree === '1' ? 'after_purchase' : isFree === 0 || isFree === '0' || isFree === 2 || isFree === '2' ? 'preview' : null)
const pick = (map, v) => map[String(int(v))] ?? null

// ---- site settings ------------------------------------------------------------------------------------------------
export function mapSiteInfo(r) {
  const warnings = []
  const num = (v, name) => { const p = parseMoney(v); if (!p.ok) { warnings.push(`${name}: ${p.reason} (raw ${JSON.stringify(p.raw)}) — left at default, owner must confirm`); return undefined } return Number(p.value) }
  const row = {
    site_name: str(r.name), phone: str(r.phone), email: str(r.email), description: str(r.description), keywords: str(r.keywords),
    facebook: str(r.facebook), twitter: str(r.twitter), instagram: str(r.instagram), youtube: str(r.youtube), telegram: str(r.telegram),
    linkedin: str(r.linkedin), whatsapp: str(r.whatsapp), broadcast: str(r.broadcast),
    affiliate_commission_percent: num(r.percentage, 'percentage'), commission_freeze_days: num(r.period_freeze_profit, 'period_freeze_profit'),
    min_withdrawal_amount: num(r.less_amount_withdraw, 'less_amount_withdraw'),
    show_poster_desktop: bool(r.show_poster_pc), show_poster_mobile: bool(r.show_poster_mob), show_free_book_button: r.show_free_book_btn == null ? true : bool(r.show_free_book_btn),
  }
  // payment_mode is deliberately NOT applied (a legacy "live" must not switch the new system to live without a gateway).
  warnings.push(`legacy payment_mode=${JSON.stringify(r.payment_mode)} reported only; the new system stays in test mode until a gateway is approved`)
  for (const k of Object.keys(row)) if (row[k] === undefined) delete row[k]
  return ok(row, { legacyAssets: { logo: str(r.logo), poster: str(r.poster), poster_mob: str(r.poster_mob) } }, warnings)
}

// ---- catalog ------------------------------------------------------------------------------------------------------
export function mapCategory(r) {
  if (!r.name || !String(r.name).trim()) return no('empty category name')
  return ok({ legacy_id: int(r.id), name: String(r.name).trim(), slug: `c-${int(r.id)}`, is_active: bool(r.status), deleted_at: iso(r.deleted_at), image_path: null },
    { legacyImage: str(r.file) }, r.file ? [] : [])
}

export function mapMaker(r, { sanitize = (x) => x, rewriteImages = (h) => ({ html: h, unresolved: [] }) } = {}) {
  if (!r.name || !String(r.name).trim()) return no('empty maker name')
  const kind = ['author', 'reader', 'writer'].includes(r.type) ? r.type : null
  if (!kind) return no(`unknown maker type ${JSON.stringify(r.type)}`)
  const rw = r.bio ? rewriteImages(r.bio) : { html: null, unresolved: [] }
  return ok({
    legacy_id: int(r.id), name: String(r.name).trim(), kind, era: r.age === 'old' ? 'old' : 'new',
    bio_html: rw.html ? sanitize(rw.html) : null, is_active: bool(r.status), deleted_at: iso(r.deleted_at), image_path: null,
  }, { legacyImage: str(r.file), unresolvedImages: rw.unresolved })
}

/**
 * books: price parsed with legacy_cost_raw kept. A free book approved from a request-book path stores NULL cost => 0.00;
 * a paid book with NULL/invalid cost is rejected (docs/14 §3.2).
 */
export function mapBook(r, { sanitize = (x) => x, rewriteImages = (h) => ({ html: h, unresolved: [] }) } = {}) {
  const warnings = []
  const kind = r.type === 'free' ? 'free' : r.type === 'paid' ? 'paid' : null
  if (!kind) return no(`unknown book type ${JSON.stringify(r.type)}`)
  const status = pick(BOOK_STATUS, r.status)
  if (!status) return no(`status outside the documented set: ${JSON.stringify(r.status)}`)
  if (!r.name || !String(r.name).trim()) return no('empty title')
  let price = '0.00'
  if (kind === 'paid') {
    const p = parseMoney(r.cost)
    if (!p.ok) return no(`paid book with unusable cost (${p.reason}, raw ${JSON.stringify(p.raw)})`)
    if (Number(p.value) <= 0) return no('paid book with non-positive price')
    price = p.value
    if (p.rounded) warnings.push(`cost ${JSON.stringify(r.cost)} rounded to ${p.value}`)
  } else if (r.cost != null && parseMoney(r.cost).ok && Number(parseMoney(r.cost).value) > 0) {
    warnings.push(`free book carries a non-zero legacy cost ${JSON.stringify(r.cost)} — imported as 0.00, raw kept`)
  }
  const cats = parseJsonColumn(r.category)
  const tags = parseJsonColumn(r.tags)
  if (!cats.ok) warnings.push('category JSON invalid — no category links created (never guessed)')
  if (!tags.ok) warnings.push('tags JSON invalid — no tags created')
  const rw = r.about ? rewriteImages(r.about) : { html: null, unresolved: [] }
  const makers = [['author_id', 'author'], ['reader_id', 'reader'], ['writer_id', 'writer']]
    .filter(([c]) => r[c] != null && r[c] !== '').map(([c, role]) => ({ legacy_maker_id: int(r[c]), role }))
  const deleted_at = iso(r.deleted_at)
  return ok({
    legacy_id: int(r.id), title: String(r.name).trim(), description_html: rw.html ? sanitize(rw.html) : null, kind,
    status: deleted_at ? 'archived' : status, price_amount: Number(price), price_currency: String(r.currency || 'USD').slice(0, 3).toUpperCase(),
    pages: int(r.pages) ?? 0, legacy_cost_raw: r.cost == null ? null : String(r.cost), created_at: iso(r.created_at) ?? undefined, deleted_at, cover_path: null,
  }, {
    categoryLegacyIds: cats.ok ? cats.value.map((x) => int(x)).filter(Number.isInteger) : [],
    tags: tags.ok ? [...new Set(tags.value.map((t) => String(t).trim()).filter(Boolean))] : [],
    makers, ownerLegacyUserId: int(r.user_id), requestBookLegacyId: int(r.request_book_id), legacyCover: str(r.file), unresolvedImages: rw.unresolved,
  }, warnings)
}

export function mapBookMedia(r) {
  const visibility = mapMediaVisibility(r.is_free)
  const warnings = []
  if (visibility === null) warnings.push(`is_free=${JSON.stringify(r.is_free)} unknown — defaulted to the gated "after_purchase"`)
  const external = bool(r.external)
  if (external && !/^https?:\/\//i.test(String(r.file ?? ''))) return no('external media without an http(s) URL')
  if (!external && !r.file) return no('internal media row without a file path')
  return ok({
    legacy_book_media_id: int(r.id), visibility: visibility ?? 'after_purchase', kind: r.type === 'audio' ? 'audio' : 'file',
    name: str(r.name) ?? '', extension: str(r.extension), page_count: int(r.page_count) ?? 0, sort_order: int(r.order) ?? 0,
    is_external: external, external_url: external ? String(r.file) : null, legacy_download_count: int(r.download),
    legacy_path: external ? null : `storage/app/public/${String(r.file).replace(/^\/+/, '')}`,
  }, { legacyBookId: int(r.book_id) }, warnings)
}

export function mapArticle(r, { sanitize = (x) => x, rewriteImages = (h) => ({ html: h, unresolved: [] }) } = {}) {
  if (!r.title) return no('empty title')
  if (!['article', 'video', 'ads'].includes(r.article_type)) return no(`unknown article_type ${JSON.stringify(r.article_type)}`)
  const rw = r.content ? rewriteImages(r.content) : { html: null, unresolved: [] }
  const deleted_at = iso(r.deleted_at)
  return ok({
    legacy_id: int(r.id), kind: r.article_type, title: String(r.title), excerpt: str(r.pref), content_html: rw.html ? sanitize(rw.html) : null,
    status: deleted_at ? 'archived' : bool(r.status) ? 'published' : 'draft', deleted_at, poster_path: null,
  }, { legacyPoster: str(r.poster), adminAuthored: r.guard === 'admin', unresolvedImages: rw.unresolved })
}

export function mapPage(r, { sanitize = (x) => x } = {}) {
  if (!r.url || /\s|\//.test(r.url)) return no(`unusable page slug ${JSON.stringify(r.url)}`)
  const pos = parseJsonColumn(r.position)
  const positions = pos.ok ? pos.value.filter((p) => p === 'header' || p === 'footer') : []
  const deleted_at = iso(r.deleted_at)
  return ok({
    legacy_id: int(r.id), slug: String(r.url), title: String(r.title ?? r.url), content_html: r.content ? sanitize(String(r.content)) : null,
    positions, status: deleted_at ? 'archived' : bool(r.status) ? 'published' : 'draft', deleted_at,
  }, {}, pos.ok ? [] : ['position JSON invalid — no header/footer placement'])
}

/** pages.url has no uniqueness in legacy: keep the live row (highest id), suffix the others, report every collision. */
export function resolvePageSlugs(rows) {
  const bySlug = new Map()
  for (const r of rows) bySlug.set(r.slug, [...(bySlug.get(r.slug) ?? []), r])
  const collisions = []
  for (const [slug, list] of bySlug) {
    if (list.length < 2) continue
    list.sort((a, b) => (a.deleted_at ? 1 : 0) - (b.deleted_at ? 1 : 0) || b.legacy_id - a.legacy_id)
    list.slice(1).forEach((r) => { r.slug = `${slug}-legacy-${r.legacy_id}`; if (!r.deleted_at) r.status = r.status === 'published' ? 'draft' : r.status })
    collisions.push({ slug, legacy_ids: list.map((r) => r.legacy_id) })
  }
  return { rows, collisions }
}

/** M5: rewrite <img src=".../public/uploads/editor/<file>"> through a resolver; report unresolved files. */
export function rewriteEditorImages(html, resolve) {
  const unresolved = []
  const out = String(html).replace(/(<img\b[^>]*?\bsrc=)(["'])([^"']*\/public\/uploads\/editor\/([^"'?#/]+))\2/gi, (m, pre, q, url, file) => {
    const next = resolve(file)
    if (!next) { unresolved.push(file); return m }
    return `${pre}${q}${next}${q}`
  })
  return { html: out, unresolved }
}

// ---- identity (customer data: opt-in) ------------------------------------------------------------------------------
/** No password, default_password, remember_token or reset data ever leaves this function. */
export function mapUser(r, { includePii = false } = {}) {
  const email = r.email == null ? '' : String(r.email).trim().toLowerCase()
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return no('missing or invalid e-mail (legacy-only record)')
  const status = pick(USER_STATUS, r.status)
  if (!status) return no(`status outside the documented set: ${JSON.stringify(r.status)}`)
  const deleted_at = iso(r.deleted_at)
  const profile = {
    legacy_user_id: int(r.id), display_name: String(r.nickname || r.name || email.split('@')[0]).slice(0, 120), status,
    is_affiliate: int(r.type) === 2, // identify affiliates by type, never by created_by (docs/14 §6)
    require_password_reset: true, deleted_at,
    ...(includePii ? { phone: str(r.phone), country: str(r.country), country_code: str(r.country_code), region: str(r.region) } : {}),
  }
  return ok(profile, {
    auth: { email, email_confirmed: !!r.email_verified_at && !deleted_at, create_login: !deleted_at }, // invitation held, never sent
    guestCreated: r.created_by == null && !!r.default_password,
    legacyBalanceRaw: str(r.balance),
  })
}

// ---- commerce history (verbatim) -----------------------------------------------------------------------------------
const REDACT = /card|pan|cvv|cvc|token|secret|password|authorization/i
export function redactResponse(raw) {
  if (raw == null || raw === '') return null
  let v
  try { v = typeof raw === 'string' ? JSON.parse(raw) : raw } catch { return { unparsed: true } }
  const walk = (x) => Array.isArray(x) ? x.map(walk) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([k, val]) => [k, REDACT.test(k) ? '[redacted]' : walk(val)])) : x
  return walk(v)
}

export function mapOrder(r) {
  const amt = parseMoney(r.amount)
  if (!amt.ok) return no(`amount unusable (${amt.reason}, raw ${JSON.stringify(amt.raw)}) — manual handling`)
  const mode = r.mode === 'test' ? 'test' : r.mode === 'live' ? 'live' : null
  if (!mode) return no(`mode outside {test,live}: ${JSON.stringify(r.mode)}`)
  const status = int(r.status) === 1 ? 'paid' : int(r.status) === 0 ? 'failed' : null
  if (!status) return no(`order status outside {0,1}: ${JSON.stringify(r.status)}`)
  return ok({
    legacy_order_id: int(r.id), status, mode, total_amount: amt.value, legacy_raw_amount: String(r.amount), currency: String(r.currency || 'USD').slice(0, 3).toUpperCase(),
    legacy_invoice_id: str(r.invoice_id), legacy_response: redactResponse(r.response), created_at: iso(r.created_at) ?? undefined, deleted_at: iso(r.deleted_at),
  }, { userLegacyId: r.user_id == null ? null : int(r.user_id), affiliateLegacyId: r.affiliate_id == null ? null : int(r.affiliate_id), transactionId: str(r.transaction_id) })
}

export function mapOrderItem(r) {
  const cost = r.cost == null ? { ok: true, value: '0.00', raw: null } : parseMoney(r.cost)
  if (!cost.ok) return no(`line cost unusable (${cost.reason}, raw ${JSON.stringify(cost.raw)})`)
  const extra = (v) => { if (v == null || v === '') return null; const p = parseMoney(v, { dp: 4, allowNegative: true }); return p.ok ? p.value : null }
  return ok({
    legacy_item_id: int(r.id), unit_price: cost.value, legacy_raw_cost: r.cost == null ? null : String(r.cost),
    selling_fee: extra(r.selling_fee), selling_fee_tax: extra(r.selling_fee_tax), cart_fee: extra(r.cart_fee), book_tax: extra(r.book_tax), net_total: extra(r.net_total),
  }, { orderLegacyId: int(r.order_id), bookLegacyId: r.book_id == null ? null : int(r.book_id) })
}

/** Entitlements are derived, never invented: paid, non-deleted orders only; test-mode orders only if explicitly allowed. */
export function deriveEntitlements(orders, items, { grantTest = false, includeDeleted = false } = {}) {
  const eligible = new Map(orders.filter((o) => o.status === 'paid' && (includeDeleted || !o.deleted_at) && (grantTest || o.mode === 'live')).map((o) => [o.legacy_order_id, o]))
  const seen = new Map()
  for (const it of items) {
    const o = eligible.get(it.orderLegacyId)
    if (!o || it.bookLegacyId == null || o.userLegacyId == null) continue
    const key = `${o.userLegacyId}:${it.bookLegacyId}`
    if (!seen.has(key)) seen.set(key, { userLegacyId: o.userLegacyId, bookLegacyId: it.bookLegacyId, is_test: o.mode === 'test', legacy_order_id: o.legacy_order_id })
  }
  return [...seen.values()]
}

export function mapAffiliateOrder(r, orderMode = 'live') {
  const amount = parseMoney(r.amount), pct = parseMoney(r.percentage), profit = parseMoney(r.profit)
  const bad = [['amount', amount], ['percentage', pct], ['profit', profit]].find(([, p]) => !p.ok)
  if (bad) return no(`${bad[0]} unusable (${bad[1].reason}, raw ${JSON.stringify(bad[1].raw)})`)
  if (!r.available_at) return no('available_at missing')
  return ok({
    legacy_id: int(r.id), gross_amount: amount.value, percent: pct.value, amount: profit.value, currency: String(r.currency || 'USD').slice(0, 3).toUpperCase(),
    available_at: iso(r.available_at), is_test: orderMode === 'test', legacy_raw: { amount: String(r.amount), percentage: String(r.percentage), profit: String(r.profit), status: int(r.status) },
  }, { orderLegacyId: int(r.order_id), affiliateLegacyId: int(r.affiliate_id), legacyStatus: int(r.status) })
}

export function mapWithdraw(r) {
  const status = pick(WITHDRAW_STATUS, r.status)
  if (!status) return no(`status outside {0,1,2}: ${JSON.stringify(r.status)}`)
  const amt = parseMoney(r.amount)
  if (!amt.ok) return no(`amount unusable (${amt.reason}, raw ${JSON.stringify(amt.raw)})`)
  if (Number(amt.value) <= 0) return no('non-positive amount')
  return ok({
    legacy_id: int(r.id), status, amount: amt.value, currency: String(r.currency || 'USD').slice(0, 3).toUpperCase(), note: str(r.message),
    requested_at: iso(r.created_at) ?? undefined, legacy_raw: { amount: String(r.amount), status: int(r.status) },
  }, { affiliateLegacyId: int(r.affiliate_id), legacyAttachment: str(r.attachment) })
}

export function mapWithdrawType(r) {
  const kind = r.type === 'paypall' || r.type === 'paypal' ? 'paypal' : r.type === 'bank_transfer' ? 'bank_transfer' : null
  if (!kind) return no(`unknown payout type ${JSON.stringify(r.type)}`)
  let details
  try { details = typeof r.data === 'string' ? JSON.parse(r.data) : r.data } catch { return no('payout data is not valid JSON') }
  if (!details || typeof details !== 'object') return no('empty payout data')
  return ok({ kind, details: Object.fromEntries(Object.entries(details).map(([k, v]) => [k, String(v)])) }, { affiliateLegacyId: int(r.affiliate_id), legacyKind: r.type })
}

export function mapRequestBook(r, { includeSensitive = false } = {}) {
  const status = pick(REQUEST_STATUS, r.status)
  if (!status) return no(`status outside {0,1,2}: ${JSON.stringify(r.status)}`)
  if (!r.name) return no('empty title')
  let cost = null
  if (r.cost != null) { const p = parseMoney(r.cost); if (!p.ok) return no(`cost unusable (${p.reason})`); cost = Number(p.value) }
  return ok({
    legacy_id: int(r.id), title: String(r.name), maker_name: str(r.maker), about: str(r.about), deal: r.type_deal === 'rent' ? 'rent' : 'share', cost, status,
    currency: String(r.currency || 'USD').slice(0, 3).toUpperCase(), whatsapp: includeSensitive ? str(r.whatsapp) : null, iban: includeSensitive ? str(r.iban) : null,
  }, { userLegacyId: int(r.user_id), legacyFiles: { book: str(r.book), cover: str(r.cover), iban_file: str(r.iban_file), ministry_file: str(r.ministry_file) } })
}

export function mapComment(r) {
  if (!r.comment || !String(r.comment).trim()) return no('empty comment')
  return ok({ legacy_id: int(r.id), body: String(r.comment).slice(0, 4000), status: bool(r.status) ? 'approved' : 'pending', visible_to_public: bool(r.show_in_home) }, { userLegacyId: int(r.user_id), bookLegacyId: int(r.book_id) }, r.file ? ['comment attachment not migrated'] : [])
}

export function mapFavourite(r) {
  if (r.tb !== 'books' && r.tb !== 'articles') return no(`unknown favourite target ${JSON.stringify(r.tb)}`)
  return ok({}, { userLegacyId: int(r.user_id), target: r.tb, targetLegacyId: int(r.tb_id) })
}

export function mapContact(r) {
  const subject = ['note', 'request', 'report', 'other'].includes(r.subject) ? r.subject : 'other'
  if (!r.message || !r.email) return no('empty message or e-mail')
  return ok({ name: String(r.name ?? ''), email: String(r.email).toLowerCase(), subject, message: String(r.message).slice(0, 5000), created_at: iso(r.created_at) ?? undefined })
}
