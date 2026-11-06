<script setup lang="ts">
// Port of resources/views/front/login.blade.php — authentication by Supabase Auth (cookie SSR session).
import { loginSchema } from '~~/shared/schemas'

definePageMeta({ middleware: 'guest' })
const client = useSupabaseClient()
const route = useRoute()
const form = reactive({ email: '', password: '' })
const { errors, busy, failure, validate } = useZodForm(loginSchema, form)
const notice = computed(() => (route.query.registered ? 'تم إنشاء الحساب. تحقق من بريدك الإلكتروني لتأكيد الحساب ثم سجّل الدخول.' : route.query.reset ? 'تم تغيير كلمة المرور، سجّل الدخول.' : ''))

async function submit() {
  failure.value = ''
  if (!validate()) return
  busy.value = true
  const { error } = await client.auth.signInWithPassword({ email: form.email.trim().toLowerCase(), password: form.password })
  busy.value = false
  if (error) { failure.value = authMessage(error); return }
  await navigateTo(safeRedirect(route.query.redirect))
}
</script>

<template>
  <div>
    <PageHeading title="تسجيل الدخول" />
    <div class="row justify-content-center">
      <div class="col-lg-6">
        <form class="wp_form" novalidate @submit.prevent="submit">
          <div class="row">
            <div class="col-lg-12">
              <div v-if="notice" class="alert alert-success" role="status">{{ notice }}</div>
              <div v-if="failure" class="alert alert-danger" role="alert">{{ failure }}</div>
              <div class="form-group">
                <label for="l-email">البريد الإلكترونى</label>
                <input id="l-email" v-model="form.email" placeholder="البريد الإلكترونى" class="form-control" :class="{ 'is-invalid': errors.email }" name="email" type="email" autocomplete="username" autofocus>
                <small v-if="errors.email" class="text-danger">{{ errors.email }}</small>
              </div>
              <div class="form-group">
                <label for="password">كلمة المرور</label>
                <input id="password" v-model="form.password" placeholder="كلمة المرور" type="password" class="form-control" :class="{ 'is-invalid': errors.password }" name="password" autocomplete="current-password">
                <small v-if="errors.password" class="text-danger">{{ errors.password }}</small>
              </div>
              <div class="text-center">
                <button class="wp_btn btn-block" type="submit" :disabled="busy">{{ busy ? 'جاري الدخول…' : 'الدخول' }}</button>
              </div>
              <div class="row">
                <div class="col-md-12"><div class="text-center mt-3"><NuxtLink to="/forgot-password" class="wp_link" style="text-decoration: underline">نسيت كلمة المرور؟</NuxtLink></div></div>
                <div class="col-md-12"><div class="text-center mt-3"><NuxtLink to="/register" class="wp_link" style="text-decoration: underline">انشاء حساب</NuxtLink></div></div>
              </div>
            </div>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>
