// Nuxt layer used ONLY by `npm run dev:hosted:3100`: moves the build directory so a second dev server (pointed at the hosted
// project through .env.hosted) can run next to the local one without sharing `.nuxt` or its lock.
export default defineNuxtConfig({ buildDir: '.nuxt-hosted' })
