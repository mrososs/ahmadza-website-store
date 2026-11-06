import { assertAuthorizedSupabaseTarget } from '~~/shared/utils/supabaseTarget'

// Fail fast at server start if the configured Supabase project is not local or the authorised AAWRAQ project.
export default defineNitroPlugin(() => {
  const url = useRuntimeConfig().public.supabase?.url as string | undefined
  const target = assertAuthorizedSupabaseTarget(url, { production: process.env.NODE_ENV === 'production' })
  console.info(`[aawraq] Supabase target: ${target.kind === 'hosted' ? `hosted ${target.ref}` : 'local'}`)
})
