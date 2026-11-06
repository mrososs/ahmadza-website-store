<script setup lang="ts">
// Port of resources/views/front/forgetPassword.blade.php — Supabase recovery e-mail (short-lived link, no tokens of ours).
import { forgotPasswordSchema } from '~~/shared/schemas'

definePageMeta({ middleware: 'guest' })
const client = useSupabaseClient()
const siteUrl = (useRuntimeConfig().public.siteUrl as string).replace(/\/$/, '')
const form = reactive({ email: '' })
const { errors, busy, failure, validate } = useZodForm(forgotPasswordSchema, form)
const done = ref(false)

async function submit() {
  failure.value = ''
  if (!validate()) return
  busy.value = true
  const { error } = await client.auth.resetPasswordForEmail(form.email.trim().toLowerCase(), { redirectTo: `${siteUrl}/confirm?next=/reset-password` })
  busy.value = false
  if (error && error.code === 'over_email_send_rate_limit') { failure.value = authMessage(error); return }
  done.value = true // same answer whether or not the address exists
}
</script>

<template>
  <div>
    <PageHeading title="إستعادة كلمة المرور" />
    <div class="row justify-content-center">
      <div class="col-md-6">
        <div v-if="done" class="alert alert-success" role="status">إن كان هذا البريد مسجلاً لدينا فقد أرسلنا إليه رابط إستعادة كلمة المرور.</div>
        <form v-else class="wp_form" novalidate @submit.prevent="submit">
          <div v-if="failure" class="alert alert-danger" role="alert">{{ failure }}</div>
          <div class="form-group">
            <label for="f-email">البريد الإلكترونى</label>
            <input id="f-email" v-model="form.email" class="form-control" :class="{ 'is-invalid': errors.email }" name="email" type="email" placeholder="البريد الإلكترونى" autocomplete="email">
            <small v-if="errors.email" class="text-danger">{{ errors.email }}</small>
          </div>
          <div class="text-center"><button class="wp_btn btn-block" type="submit" :disabled="busy">{{ busy ? 'جاري الإرسال…' : 'إستعادة كلمة المرور' }}</button></div>
        </form>
      </div>
    </div>
  </div>
</template>
