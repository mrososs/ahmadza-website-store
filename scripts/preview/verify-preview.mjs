// Post-deploy check of a PROTECTED PREVIEW. Run it against the deployed origin; it proves the gate works from the outside.
//   PREVIEW_PASSWORD=... node scripts/preview/verify-preview.mjs https://preview.example.com preview-user
// The password is read from the environment (never the command line, so it stays out of shell history) and is never printed. Exit 0 = all checks passed.
const [origin, user] = process.argv.slice(2)
const password = process.env.PREVIEW_PASSWORD
if (!origin || !user || !password) { console.error('usage: PREVIEW_PASSWORD=... node scripts/preview/verify-preview.mjs <origin> <user>'); process.exit(2) }
const base = origin.replace(/\/+$/, '')
const auth = (u, p) => ({ authorization: `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}` })
let failed = 0
const check = async (name, fn) => {
  try { const ok = await fn(); console.log(`${ok === true ? 'ok  ' : 'FAIL'}  ${name}${ok === true ? '' : `  (${ok})`}`); if (ok !== true) failed++ } catch (e) { console.log(`FAIL  ${name}  (${e.message})`); failed++ }
}
const get = (path, headers = {}, init = {}) => fetch(base + path, { redirect: 'manual', headers, ...init })

await check('the origin is https (a gateway or browser must not talk to the preview in clear text)', async () => base.startsWith('https://') || `origin is ${base.split(':')[0]}`)
await check('anonymous visitors are challenged, with no content and a noindex header', async () => {
  const r = await get('/')
  return r.status === 401 && /^Basic /.test(r.headers.get('www-authenticate') ?? '') && /noindex/.test(r.headers.get('x-robots-tag') ?? '') && (await r.text()) === 'Authentication required' || `status ${r.status}`
})
await check('API and admin are challenged too', async () => { for (const p of ['/api/admin/books', '/admin', '/api/cart/quote']) { const r = await get(p); if (r.status !== 401) return `${p} -> ${r.status}` } return true })
await check('robots.txt is open and disallows everything', async () => { const r = await get('/robots.txt'); return (r.status === 200 && (await r.text()).includes('Disallow: /')) || `status ${r.status}` })
await check('a wrong password and a wrong user name are refused', async () => (await get('/', auth(user, `${password}x`))).status === 401 && (await get('/', auth(`${user}x`, password))).status === 401)
await check('valid credentials reach the site, marked noindex and never cacheable by a shared cache', async () => {
  const r = await get('/', auth(user, password))
  const cc = r.headers.get('cache-control') ?? ''
  return (r.status === 200 && /noindex/.test(r.headers.get('x-robots-tag') ?? '') && /no-store/.test(cc) && !/s-maxage/.test(cc)) || `status ${r.status}, cache-control "${cc}"`
})
await check('a missing page is not cacheable either', async () => { const r = await get('/book/99999999', auth(user, password)); return /no-store/.test(r.headers.get('cache-control') ?? '') || `cache-control "${r.headers.get('cache-control')}"` })
await check('checkout, payment webhooks and downloads are switched off even with the right password', async () => {
  for (const [m, p] of [['POST', '/api/checkout/session'], ['POST', '/api/webhooks/payments/paymob'], ['POST', '/api/webhooks/payments/tap'], ['GET', '/api/library/download/1']]) {
    const r = await get(p, { ...auth(user, password), 'content-type': 'application/json' }, { method: m, body: m === 'POST' ? '{}' : undefined })
    if (r.status !== 503) return `${m} ${p} -> ${r.status}`
  }
  return true
})
await check('the admin API needs a session even with the preview password (and the second factor in production)', async () => { const r = await get('/api/admin/books', auth(user, password)); return r.status === 401 || `status ${r.status}` })
console.log(failed ? `\n${failed} check(s) FAILED: do not share this preview.` : '\nAll checks passed.')
process.exit(failed ? 1 : 0)
