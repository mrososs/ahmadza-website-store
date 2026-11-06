<script setup lang="ts">
// resources/views/affiliate/user/create.blade.php (storefront shell). Legacy: a guest form created a customer with
// type = 2 immediately and logged them in. Here: sign up (Supabase Auth, e-mail confirmation) -> after confirming and
// signing in, activation is a single server call (POST /api/affiliate/register). Nickname / phone fields of the legacy
// form are not collected here (no matching profile data model; phone is editable from the profile page).
import { registerSchema } from '~~/shared/schemas'

const client = useSupabaseClient()
const { info, isAuthed } = useSessionInfo()
const { data: program } = await useFetch<{ percent: number }>('/api/affiliate/program', { default: () => ({ percent: 0 }) })

const form = reactive({ displayName: '', email: '', password: '', passwordConfirm: '' })
const { errors, busy, failure, validate } = useZodForm(registerSchema, form)
const done = ref('')

async function signUp() {
  failure.value = ''
  if (!validate()) return
  busy.value = true
  try {
    const { error } = await client.auth.signUp({
      email: form.email.trim().toLowerCase(), password: form.password,
      options: { data: { display_name: form.displayName.trim() }, emailRedirectTo: `${location.origin}/confirm?next=/affiliate-register` },
    })
    if (error) { failure.value = authMessage(error); return }
    done.value = 'تم إنشاء الحساب. افتح رسالة التأكيد في بريدك ثم سجّل الدخول وأكمل تفعيل حساب التسويق من هذه الصفحة.'
  } finally { busy.value = false }
}

async function activate() {
  failure.value = ''
  busy.value = true
  try {
    await $fetch('/api/affiliate/register', { method: 'POST' })
    await navigateTo('/affiliate')
  } catch (e) { failure.value = partnerErrorMessage(e) } finally { busy.value = false }
}
</script>

<template>
  <div>
    <PageHeading title="سوق معنا" />
    <div class="row justify-content-center">
      <div class="col-12">
        <div class="alert alert-success">
          <strong>لا تضيع الفرصة!</strong>
          سجّل الآن واحصل على عمولة تصل الى <span>{{ program?.percent ?? 0 }}</span>% عن كل عملية شراء تتم عبر رابطك الخاص.
        </div>
      </div>
      <div class="col-xl-8">
        <div v-if="failure" class="alert alert-danger" role="alert">{{ failure }}</div>
        <div v-if="done" class="alert alert-info" role="status">{{ done }}</div>

        <div v-if="isAuthed" class="wp_form">
          <p>أنت مسجّل الدخول باسم <strong>{{ info?.displayName || info?.email }}</strong>.</p>
          <NuxtLink v-if="info?.isAffiliate" to="/affiliate" class="wp_btn btn-block text-center">الذهاب إلى لوحة المسوّق</NuxtLink>
          <button v-else type="button" class="wp_btn btn-block" :disabled="busy" @click="activate">تفعيل حساب التسويق بالعمولة</button>
        </div>

        <form v-else-if="!done" id="register_form" class="wp_form" novalidate @submit.prevent="signUp">
          <div class="row">
            <div class="col-sm-6">
              <div class="form-group">
                <label for="aff-name">الأسم بالكامل</label>
                <input id="aff-name" v-model="form.displayName" placeholder="الأسم بالكامل" type="text" class="form-control" :class="{ 'is-invalid': errors.displayName }" name="name" autocomplete="name">
                <span v-if="errors.displayName" class="invalid-feedback d-block">{{ errors.displayName }}</span>
              </div>
            </div>
            <div class="col-sm-6">
              <div class="form-group">
                <label for="aff-email">البريد الإلكترونى</label>
                <input id="aff-email" v-model="form.email" placeholder="البريد الإلكترونى" type="email" class="form-control" :class="{ 'is-invalid': errors.email }" name="email" autocomplete="email">
                <span v-if="errors.email" class="invalid-feedback d-block">{{ errors.email }}</span>
              </div>
            </div>
            <div class="col-sm-6">
              <div class="form-group">
                <label for="aff-pass">كلمة المرور</label>
                <input id="aff-pass" v-model="form.password" placeholder="كلمة المرور" type="password" class="form-control" :class="{ 'is-invalid': errors.password }" name="password" autocomplete="new-password">
                <span v-if="errors.password" class="invalid-feedback d-block">{{ errors.password }}</span>
              </div>
            </div>
            <div class="col-sm-6">
              <div class="form-group">
                <label for="aff-pass2">تأكيد كلمة المرور</label>
                <input id="aff-pass2" v-model="form.passwordConfirm" placeholder="تأكيد كلمة المرور" type="password" class="form-control" :class="{ 'is-invalid': errors.passwordConfirm }" name="password_confirmation" autocomplete="new-password">
                <span v-if="errors.passwordConfirm" class="invalid-feedback d-block">{{ errors.passwordConfirm }}</span>
              </div>
            </div>
            <div class="col-12">
              <div class="form-group">
                <button type="submit" class="wp_btn btn-block" :disabled="busy">تسجيل</button>
              </div>
              <p class="text-center">لديك حساب؟ <NuxtLink :to="{ path: '/login', query: { redirect: '/affiliate-register' } }">سجّل الدخول</NuxtLink> ثم فعّل حساب التسويق.</p>
            </div>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>
