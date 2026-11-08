#!/usr/bin/env node
// Recover the legacy AAWRAQ articles from the archived pages stored OUTSIDE the repository (secondary evidence).
//   node scripts/recovery/recover-articles.mjs --evidence D:/mostqel/aawraq-archive-evidence            -> report only
//   node scripts/recovery/recover-articles.mjs --evidence ... --apply --target recovery|hosted           -> idempotent import as DRAFT
// Never invents a title, author, date, category or body: whatever the evidence does not carry stays null and is listed in `missing`.
// Archived HTML is untrusted: it is parsed as text and the body is sanitised before it is stored.
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import sanitizeHtml from 'sanitize-html'
import { createClient } from '@supabase/supabase-js'
import { assertAuthorizedSupabaseTarget } from '../../shared/utils/supabaseTarget.ts'
import { ROOT } from '../migration/lib/paths.mjs'
import { loadEnv, localUrlOrThrow } from '../migration/lib/supabase.mjs'

const require = createRequire(import.meta.url)
const { parseDocument } = require('htmlparser2')
const { findAll, getAttributeValue, textContent, getInnerHTML } = require('domutils')

const args = process.argv.slice(2)
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d }
const EVIDENCE = opt('--evidence')
const APPLY = args.includes('--apply')
const TARGET = opt('--target', 'recovery')
if (!EVIDENCE) { console.error('usage: --evidence <dir> [--apply --target recovery|hosted]'); process.exit(2) }

// Same policy as server/utils/sanitize.ts (sanitizeRichText); legacy-host images are dropped below because the host is gone.
export function sanitizeBody(html) {
  return sanitizeHtml(html, {
    allowedTags: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'ul', 'ol', 'li', 'h2', 'h3', 'h4', 'blockquote', 'a', 'img', 'span', 'div', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr'],
    allowedAttributes: { a: ['href', 'title', 'target', 'rel'], img: ['src', 'alt', 'title', 'width', 'height'], '*': ['dir', 'lang'] },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedSchemesByTag: { img: ['http', 'https'] },
    transformTags: { a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer nofollow' }) },
  })
}
const plain = (html) => sanitizeHtml(html ?? '', { allowedTags: [], allowedAttributes: {} }).replace(/\s+/g, ' ').trim()
const cls = (n, c) => (getAttributeValue(n, 'class') ?? '').split(/\s+/).includes(c)
const sha = (s) => createHash('sha256').update(s).digest('hex')

const manifest = JSON.parse(readFileSync(`${EVIDENCE}/manifest.json`, 'utf8')).filter((m) => m.status === 200)
const versions = []
for (const m of manifest) {
  const html = readFileSync(`${EVIDENCE}/html/${m.file}`, 'utf8')
  if (/Domain Default page/.test(html) || !(/article_content/.test(html) && /editor_txt/.test(html))) continue
  const doc = parseDocument(html)
  const title = textContent(findAll((n) => n.name === 'h3' && cls(n, 'wp_h3'), doc.children)[0] ?? { children: [] }).replace(/\s+/g, ' ').trim()
  const body = findAll((n) => n.type === 'tag' && cls(n, 'editor_txt'), doc.children)[0]
  if (!title || !body) continue
  const canonical = findAll((n) => n.name === 'link' && getAttributeValue(n, 'rel') === 'canonical', doc.children).map((n) => getAttributeValue(n, 'href')).join('')
  const head = findAll((n) => n.type === 'tag' && cls(n, 'head_article'), doc.children)[0]
  const ogdesc = findAll((n) => n.name === 'meta' && getAttributeValue(n, 'property') === 'og:description', doc.children).map((n) => getAttributeValue(n, 'content')).join('').trim()
  versions.push({ ts: m.ts, sourceUrl: m.original, file: m.file, fileSha256: m.sha256, title, canonical, headText: head ? textContent(head).replace(/\s+/g, ' ').trim() : '', ogdesc, bodyHtml: getInnerHTML(body) })
}

const refOf = (u) => {
  const x = /aawraq\.com\/(post|article)\/([^/?#]+)(?:\/([^?#]*))?/.exec(u)
  return x ? { kind: x[1], ref: x[2], slug: x[3] ? decodeURIComponent(x[3]) : null } : null
}
const groups = new Map()
for (const v of versions) { const k = v.title; groups.set(k, [...(groups.get(k) ?? []), v]) }

const records = []
for (const [title, vs] of groups) {
  vs.sort((a, b) => a.ts.localeCompare(b.ts))
  // newest capture with the longest text wins; every other capture stays in the evidence
  const best = [...vs].sort((a, b) => plain(b.bodyHtml).length - plain(a.bodyHtml).length || b.ts.localeCompare(a.ts))[0]
  const legacyImgs = [...best.bodyHtml.matchAll(/<img[^>]+src=["']([^"']+)/gi)].map((x) => x[1])
  const clean = sanitizeBody(best.bodyHtml)
    .replace(/<img\b[^>]*src="https?:\/\/(?:www\.)?aawraq\.com[^"]*"[^>]*>/gi, '')   // host is gone: no broken images, mapping kept in the evidence
  const text = plain(clean)
  const refs = new Set(); let slug = null; let numericId = null
  for (const v of vs) {
    for (const u of [v.sourceUrl, v.canonical]) {
      const r = refOf(u ?? ''); if (!r) continue
      refs.add(r.ref); if (r.slug && r.slug !== 'tel') slug ??= r.slug
      if (/^\d+$/.test(r.ref)) numericId = Number(r.ref)
    }
  }
  const missing = ['author', 'category', 'publication_date', 'publication_status']
  const poster = best.canonical ? null : null
  missing.push('poster_image')
  if (legacyImgs.length) missing.push(`${legacyImgs.length}_inline_image_files`)
  const confidence = vs.length >= 2 && text.length > 800 ? 'high' : text.length > 800 ? 'medium' : 'low'
  records.push({
    title, content_html: clean, excerpt: best.ogdesc ? best.ogdesc.slice(0, 400) : text.slice(0, 280), content_sha256: sha(`${title}\n${text}`),
    original_slug: slug, legacy_id: numericId, legacy_refs: [...refs], status: 'draft', review_status: 'unreviewed', source_system: 'internet-archive',
    source_evidence: {
      kind: 'archived_public_page', secondary_evidence: true, confidence, text_chars: text.length, versions: vs.length,
      captures: vs.map((v) => ({ ts: v.ts, url: v.sourceUrl, file_sha256: v.fileSha256, text_chars: plain(v.bodyHtml).length })),
      chosen_capture: best.ts, snapshot_counters_text: best.headText, inline_images_dropped: legacyImgs.length, missing,
      note: 'Publication status at the time of the archive is unknown. Imported as draft; an administrator must review before publishing.',
    },
    _poster: poster,
  })
}
for (const r of records) delete r._poster

const report = {
  generated_at: new Date().toISOString(), evidence_dir: EVIDENCE, genuine_article_page_versions: versions.length,
  distinct_articles_recovered: records.length, with_original_slug: records.filter((r) => r.original_slug).length,
  with_numeric_legacy_id: records.filter((r) => r.legacy_id).length, inline_images_dropped: records.reduce((s, r) => s + r.source_evidence.inline_images_dropped, 0),
  confidence: records.reduce((a, r) => ({ ...a, [r.source_evidence.confidence]: (a[r.source_evidence.confidence] ?? 0) + 1 }), {}),
  articles: records.map((r) => ({ title: r.title, slug: r.original_slug, legacy_id: r.legacy_id, refs: r.legacy_refs.length, chars: r.source_evidence.text_chars, versions: r.source_evidence.versions, confidence: r.source_evidence.confidence })),
}
const outDir = path.resolve('migration-output'); mkdirSync(outDir, { recursive: true })
if (!APPLY) { const f = path.join(outDir, `articles-recovery-${new Date().toISOString().slice(0, 10)}.json`); writeFileSync(f, JSON.stringify({ report, records }, null, 1)); console.log(JSON.stringify(report, null, 1)); console.log('written', f); process.exit(0) }

// ---- apply: idempotent on content_sha256; never overwrites an existing article, never changes the status of an existing row
const env = loadEnv(path.join(ROOT, TARGET === 'hosted' ? '.env.hosted' : '.env.recovery'))
if (TARGET === 'hosted') { assertAuthorizedSupabaseTarget(env.NUXT_PUBLIC_SUPABASE_URL); if (env.NUXT_PUBLIC_SUPABASE_URL.replace(/\/$/, '') !== 'https://ubjuyeccioflhpcpnhmo.supabase.co') { console.error('refusing: not the authorised project'); process.exit(2) } }
else localUrlOrThrow(env.NUXT_PUBLIC_SUPABASE_URL)
const db = createClient(env.NUXT_PUBLIC_SUPABASE_URL, env.NUXT_SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
let inserted = 0; let existing = 0
for (const r of records) {
  const { data: found, error: e1 } = await db.from('articles').select('id').eq('content_sha256', r.content_sha256).maybeSingle()
  if (e1) { console.error('lookup failed:', e1.message); process.exit(1) }
  if (found) { existing++; continue }
  const { error } = await db.from('articles').insert({ kind: 'article', ...r })
  if (error) { console.error('insert failed:', r.title, error.message); process.exit(1) }
  inserted++
}
console.log(JSON.stringify({ target: TARGET, inserted, already_present: existing }))
