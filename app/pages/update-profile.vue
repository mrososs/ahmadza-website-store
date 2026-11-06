<script setup lang="ts">
// Port of resources/views/front/edit-profile.blade.php. Profile fields are updated through RLS + column grants
// (display_name/phone/country only — never status or is_affiliate); the password is changed through Supabase Auth.
import { profileUpdateSchema } from '~~/shared/schemas'
import type { Database } from '~~/shared/types/database.types'

definePageMeta({ middleware: 'auth' })
const client = useSupabaseClient<Database>()
const user = useSupabaseUser()
const { refresh } = useSessionInfo()

const form = reactive({ display_name: '', phone: '', country: '', password: '', password_confirmation: '' })
const { errors, busy, failure, validate } = useZodForm(profileUpdateSchema, form)
const success = ref('')
const email = computed(() => (user.value as { email?: string } | null)?.email ?? '')
const uid = computed(() => user.value?.id ?? (user.value as { sub?: string } | null)?.sub)

const { status } = await useAsyncData('my-profile', async () => {
  if (!uid.value) return null
  const { data } = await client.from('profiles').select('display_name,phone,country').eq('id', uid.value).maybeSingle()
  if (data) { form.display_name = data.display_name; form.phone = data.phone ?? ''; form.country = data.country ?? '' }
  return data
}, { server: false })

async function submit() {
  failure.value = ''; success.value = ''
  if (!validate()) return
  if (form.password && form.password.length < 8) { failure.value = 'كلمة المرور 8 أحرف على الأقل'; return }
  if (form.password !== form.password_confirmation) { failure.value = 'كلمتا المرور غير متطابقتين'; return }
  busy.value = true
  try {
    const { error } = await client.from('profiles').update({
      display_name: form.display_name.trim(), phone: form.phone.trim() || null, country: form.country.trim() || null,
    }).eq('id', uid.value!)
    if (error) { failure.value = 'تعذر حفظ البيانات'; return }
    if (form.password) {
      const { error: pwErr } = await client.auth.updateUser({ password: form.password })
      if (pwErr) { failure.value = authMessage(pwErr); return }
      form.password = ''; form.password_confirmation = ''
    }
    success.value = 'تم حفظ البيانات'
    await refresh()
  } finally { busy.value = false }
}
</script>

<template>
  <div>
    <PageHeading title="تعديل بياناتى" />
    <div v-if="(status === 'pending' || status === 'idle')" class="text-center p-5" role="status"><i class="fa fa-spinner fa-spin" /> جاري التحميل…</div>
    <form v-else id="wp_form" class="wp_form" novalidate @submit.prevent="submit">
      <div class="row justify-content-center">
        <div class="col-lg-6 col-12">
          <div class="form-layout">
            <div v-if="success" class="alert alert-success" role="status">{{ success }}</div>
            <div v-if="failure" class="alert alert-danger" role="alert">{{ failure }}</div>
            <div class="form-group">
              <label for="p-email">البريد الالكترونى</label>
              <input id="p-email" readonly :value="email" class="form-control" placeholder="البريد الالكترونى">
            </div>
            <div class="form-group">
              <label for="p-name">الأسم <span class="required_mark">*</span></label>
              <input id="p-name" v-model="form.display_name" name="name" class="form-control" :class="{ 'is-invalid': errors.display_name }" placeholder="الأسم">
              <small v-if="errors.display_name" class="text-danger">{{ errors.display_name }}</small>
            </div>
            <div class="form-group">
              <label for="p-phone">رقم الجوال</label>
              <input id="phone-input" v-model="form.phone" name="phone" class="form-control" type="tel" autocomplete="off">
              <small v-if="errors.phone" class="text-danger">{{ errors.phone }}</small>
            </div>
            <div class="form-group">
              <label for="p-country">الدولة</label>
              <input id="p-country" v-model="form.country" name="country" class="form-control" placeholder="الدولة">
            </div>
            <div class="form-group">
              <label for="p-pass">كلمة المرور</label>
              <input id="p-pass" v-model="form.password" autocomplete="new-password" type="password" name="password" class="form-control" placeholder="كلمة المرور">
            </div>
            <div class="form-group">
              <label for="p-pass2">تأكيد كلمة المرور</label>
              <input id="p-pass2" v-model="form.password_confirmation" autocomplete="new-password" type="password" name="password_confirmation" class="form-control" placeholder="تأكيد كلمة المرور">
            </div>
            <div class="text-center">
              <button class="btn-block wp_btn" type="submit" :disabled="busy">حفظ البيانات</button>
            </div>
          </div>
        </div>
      </div>
      <br>
    </form>
  </div>
</template>
