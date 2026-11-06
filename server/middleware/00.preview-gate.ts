import { getRequestHeader, getRequestURL, setHeader, setResponseHeaders, setResponseStatus, createError } from 'h3'
import { decide, normaliseMode, ROBOTS_DISALLOW_ALL, NOINDEX_HEADERS, NO_STORE_HEADERS } from '../utils/previewGate'
import { rateLimit } from '../utils/rateLimit'

/**
 * Route rules (swr / s-maxage on '/', '/book/**' ...) and Nitro's error pages set their cache headers AFTER this middleware ran, and would
 * otherwise let a CDN or proxy keep a page that was only served to an authenticated preview visitor. So on a protected preview the non-cacheable
 * headers are forced at the moment the response head is written, which covers normal pages, error pages and the 401 challenge alike.
 */
function forceNoStore(event: Parameters<Parameters<typeof defineEventHandler>[0]>[0]) {
  const res = event.node.res
  const writeHead = res.writeHead.bind(res) as (...a: unknown[]) => unknown
  res.writeHead = ((...args: unknown[]) => {
    for (const [k, v] of Object.entries(NO_STORE_HEADERS)) res.setHeader(k, v)
    // an explicit header object passed to writeHead would win over setHeader: strip cache headers from it too
    const last = args[args.length - 1]
    if (last && typeof last === 'object' && !Array.isArray(last)) for (const k of Object.keys(NO_STORE_HEADERS)) delete (last as Record<string, unknown>)[k]
    return writeHead(...args)
  }) as typeof res.writeHead
}

// Applies the protected-preview decision to EVERY request (pages, assets and API). See server/utils/previewGate.ts.
export default defineEventHandler((event) => {
  const cfg = useRuntimeConfig(event)
  const config = { mode: normaliseMode(cfg.previewMode, process.env.NODE_ENV === 'production'), user: String(cfg.previewUser ?? ''), passwordHash: String(cfg.previewPasswordHash ?? '') }
  if (config.mode === 'protected') forceNoStore(event)
  const d = decide({ config, path: getRequestURL(event).pathname, authorization: getRequestHeader(event, 'authorization') })
  switch (d.action) {
    case 'allow': if (Object.keys(d.headers).length) setResponseHeaders(event, d.headers); return
    case 'robots':
      setResponseHeaders(event, { ...NOINDEX_HEADERS, 'content-type': 'text/plain; charset=utf-8' })
      return ROBOTS_DISALLOW_ALL
    case 'challenge':
      if (d.failedAttempt) rateLimit(event, 'preview-auth', 20, 60_000) // wrong credentials only; a flood gets 429
      setHeader(event, 'www-authenticate', 'Basic realm="AAWRAQ preview", charset="UTF-8"')
      setResponseHeaders(event, NOINDEX_HEADERS)
      setResponseStatus(event, 401)
      return 'Authentication required'
    case 'deny':
      setResponseHeaders(event, NOINDEX_HEADERS)
      throw createError({ statusCode: d.status, statusMessage: d.message })
  }
})
