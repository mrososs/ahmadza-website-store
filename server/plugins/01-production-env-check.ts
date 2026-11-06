import { checkProductionEnv } from '~~/shared/utils/productionEnv'

// Refuse to start a production server that would be broken or unsafe in a way nobody notices; log the risky-but-legitimate choices.
export default defineNitroPlugin(() => {
  const report = checkProductionEnv(useRuntimeConfig() as never, process.env.NODE_ENV === 'production', { vercel: !!process.env.VERCEL })
  for (const w of report.warnings) console.warn(`[aawraq] config warning (${w.code}): ${w.message}`)
  if (report.errors.length) {
    throw new Error(`Refusing to start: ${report.errors.map((e) => `${e.code}: ${e.message}`).join(' | ')}`)
  }
})
