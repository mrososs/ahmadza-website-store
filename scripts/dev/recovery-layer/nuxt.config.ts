// Nuxt layer used ONLY by `npm run dev:recovery` and tests/api/preview-gate.test.ts: moves the build directory so a second dev server (pointed at the
// isolated recovery stack through .env.recovery) can run next to the everyday one without sharing `.nuxt` or its lock.
export default defineNuxtConfig({ buildDir: '.nuxt-recovery' })
