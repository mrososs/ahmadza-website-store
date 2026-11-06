<script setup lang="ts">
// Auth callback for e-mail confirmation and password recovery links (PKCE `code`, or `token_hash` + `type`).
// Client-only work: the one-time code/token is exchanged in the browser and the session cookie is written by the supabase module.
const client = useSupabaseClient()
const route = useRoute()
const failed = ref(false)

onMounted(async () => {
  const q = route.query
  let error: unknown = null
  if (typeof q.code === 'string') {
    error = (await client.auth.exchangeCodeForSession(q.code)).error
  } else if (typeof q.token_hash === 'string' && typeof q.type === 'string') {
    error = (await client.auth.verifyOtp({ token_hash: q.token_hash, type: q.type as 'signup' | 'recovery' | 'email' | 'magiclink' | 'invite' | 'email_change' })).error
  } else {
    // implicit-flow fallback: session already restored from the URL hash by supabase-js
    const { data } = await client.auth.getSession()
    error = data.session ? null : new Error('no session')
  }
  if (error) { failed.value = true; return }
  const next = safeRedirect(q.next, q.type === 'recovery' ? '/reset-password' : '/')
  await navigateTo(next, { replace: true })
})
</script>

<template>
  <div>
    <PageHeading title="تأكيد الحساب" />
    <div class="row justify-content-center">
      <div class="col-md-6">
        <div v-if="failed" class="alert alert-danger" role="alert">الرابط غير صالح أو منتهي الصلاحية. <NuxtLink to="/login">تسجيل الدخول</NuxtLink></div>
        <p v-else class="text-center p-5" role="status"><i class="fa fa-spinner fa-spin" /> جاري التحقق…</p>
      </div>
    </div>
  </div>
</template>
