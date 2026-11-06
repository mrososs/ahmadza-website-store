// Local-only Supabase access for the migration scripts. Refuses anything that is not 127.0.0.1/localhost.
// Keys are read from the git-ignored .env and are never printed.
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { ROOT } from './paths.mjs'

/**
 * Which environment file the migration scripts read. Default: the everyday dev stack (.env). AAWRAQ_ENV_FILE may name ONE other file, and only the isolated recovery
 * stack's (.env.recovery, in the repository root): nothing else can be selected, and the URL guard below still refuses anything that is not local.
 */
export function envFileFromChoice(choice = process.env.AAWRAQ_ENV_FILE) {
  if (!choice) return path.join(ROOT, '.env')
  if (choice !== '.env.recovery') throw new Error(`AAWRAQ_ENV_FILE may only be .env.recovery (got ${JSON.stringify(choice)})`)
  return path.join(ROOT, choice)
}

export function loadEnv(file = envFileFromChoice()) {
  return Object.fromEntries(
    readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('#') && l.includes('='))
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
  )
}

export function localUrlOrThrow(url) {
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url ?? '')) throw new Error(`Refusing to run against a non-local Supabase URL: ${url}`)
  return url
}

export function serviceClient() {
  const env = loadEnv()
  const url = localUrlOrThrow(env.NUXT_PUBLIC_SUPABASE_URL)
  return {
    url,
    anonKey: env.NUXT_PUBLIC_SUPABASE_KEY,
    db: createClient(url, env.NUXT_SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } }),
  }
}

export const objectPathFor = (sha256, ext) => `sha256/${sha256.slice(0, 2)}/${sha256}.${ext}`
export const EXT_FOR_TYPE = { pdf: 'pdf', mp3: 'mp3', png: 'png', jpeg: 'jpg', gif: 'gif', webp: 'webp', mp4: 'mp4' }
