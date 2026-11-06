<script setup lang="ts">
// Port of resources/views/front/register.blade.php. No password is ever stored or e-mailed by the application:
// Supabase Auth owns credentials and sends the confirmation message (local: Mailpit at http://127.0.0.1:54324).
import { registerSchema } from '~~/shared/schemas'

definePageMeta({ middleware: 'guest' })
const client = useSupabaseClient()
const siteUrl = (useRuntimeConfig().public.siteUrl as string).replace(/\/$/, '')
const form = reactive({ displayName: '', email: '', password: '', passwordConfirm: '' })
const { errors, busy, failure, validate } = useZodForm(registerSchema, form)
const done = ref(false)

async function submit() {
  failure.value = ''
  if (!validate()) return
  busy.value = true
  const { error } = await client.auth.signUp({
    email: form.email.trim().toLowerCase(), password: form.password,
    options: { data: { display_name: form.displayName.trim() }, emailRedirectTo: `${siteUrl}/confirm` },
  })
  busy.value = false
  if (error) { failure.value = authMessage(error); return }
  done.value = true // identical outcome for new and already-registered e-mails (no account enumeration)
}
</script>

<template>
  <div>
    <PageHeading title="تسجيل" />
    <div class="row justify-content-center">
      <div class="col-xl-8">
        <div v-if="done" class="alert alert-success" role="status">
          تم استلام طلبك. إن كان البريد صالحاً فقد أرسلنا إليه رابط تأكيد الحساب، افتح الرسالة ثم <NuxtLink to="/login">سجّل الدخول</NuxtLink>.
        </div>
        <form v-else id="register_form" class="wp_form" novalidate @submit.prevent="submit">
          <div v-if="failure" class="alert alert-danger" role="alert">{{ failure }}</div>
          <div class="row">
            <div class="col-sm-6">
              <div class="form-group">
                <label for="r-name">الأسم بالكامل</label>
                <input id="r-name" v-model="form.displayName" placeholder="الأسم بالكامل" type="text" class="form-control" :class="{ 'is-invalid': errors.displayName }" name="name" autocomplete="name" autofocus>
                <small v-if="errors.displayName" class="text-danger">{{ errors.displayName }}</small>
              </div>
            </div>
            <div class="col-sm-6">
              <div class="form-group">
                <label for="r-email">البريد الإلكترونى</label>
                <input id="r-email" v-model="form.email" placeholder="البريد الإلكترونى" type="email" class="form-control" :class="{ 'is-invalid': errors.email }" name="email" autocomplete="email">
                <small v-if="errors.email" class="text-danger">{{ errors.email }}</small>
              </div>
            </div>
            <div class="col-sm-6">
              <div class="form-group">
                <label for="r-pass">كلمة المرور</label>
                <input id="r-pass" v-model="form.password" placeholder="كلمة المرور" type="password" class="form-control" :class="{ 'is-invalid': errors.password }" name="password" autocomplete="new-password">
                <small v-if="errors.password" class="text-danger">{{ errors.password }}</small>
              </div>
            </div>
            <div class="col-sm-6">
              <div class="form-group">
                <label for="r-pass2">تأكيد كلمة المرور</label>
                <input id="r-pass2" v-model="form.passwordConfirm" placeholder="تأكيد كلمة المرور" type="password" class="form-control" :class="{ 'is-invalid': errors.passwordConfirm }" name="password_confirmation" autocomplete="new-password">
                <small v-if="errors.passwordConfirm" class="text-danger">{{ errors.passwordConfirm }}</small>
              </div>
            </div>
            <div class="col-12"><div class="form-group"><button type="submit" class="wp_btn btn-block" :disabled="busy">{{ busy ? 'جاري التسجيل…' : 'تسجيل' }}</button></div></div>
            <div class="col-12"><div class="text-center"><NuxtLink to="/login" class="wp_link" style="text-decoration: underline">لديك حساب؟</NuxtLink></div></div>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>
