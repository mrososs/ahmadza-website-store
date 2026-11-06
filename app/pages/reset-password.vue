<script setup lang="ts">
// Port of resources/views/front/forgetPasswordLink.blade.php. The recovery link signs the user in (see /confirm);
// this page then sets the new password through Supabase Auth.
import { resetPasswordSchema } from '~~/shared/schemas'

const client = useSupabaseClient()
const user = useSupabaseUser()
const form = reactive({ password: '', passwordConfirm: '' })
const { errors, busy, failure, validate } = useZodForm(resetPasswordSchema, form)
const hasSession = ref<boolean | null>(null)
onMounted(async () => { hasSession.value = !!(await client.auth.getSession()).data.session || !!user.value })

async function submit() {
  failure.value = ''
  if (!validate()) return
  busy.value = true
  const { error } = await client.auth.updateUser({ password: form.password })
  busy.value = false
  if (error) { failure.value = authMessage(error); return }
  await client.auth.signOut()
  await navigateTo({ path: '/login', query: { reset: '1' } })
}
</script>

<template>
  <div>
    <PageHeading title="إستعادة كلمة المرور" />
    <div class="row justify-content-center mt-3 mb-3">
      <div class="col-md-6">
        <div v-if="hasSession === false" class="alert alert-danger" role="alert">الرابط غير صالح أو منتهي. <NuxtLink to="/forgot-password">اطلب رابطاً جديداً</NuxtLink></div>
        <form v-else-if="hasSession" class="wp_form" novalidate @submit.prevent="submit">
          <div v-if="failure" class="alert alert-danger" role="alert">{{ failure }}</div>
          <div class="form-group">
            <label for="n-pass">كلمة المرور الجديدة</label>
            <input id="n-pass" v-model="form.password" type="password" class="form-control" :class="{ 'is-invalid': errors.password }" name="password" placeholder="كلمة المرور الجديدة" autocomplete="new-password">
            <small v-if="errors.password" class="text-danger">{{ errors.password }}</small>
          </div>
          <div class="form-group">
            <label for="n-pass2">تأكيد كلمة المرور</label>
            <input id="n-pass2" v-model="form.passwordConfirm" type="password" class="form-control" :class="{ 'is-invalid': errors.passwordConfirm }" name="password_confirmation" placeholder="تأكيد كلمة المرور" autocomplete="new-password">
            <small v-if="errors.passwordConfirm" class="text-danger">{{ errors.passwordConfirm }}</small>
          </div>
          <div class="text-center"><button class="wp_btn btn-block" type="submit" :disabled="busy">{{ busy ? 'جاري الحفظ…' : 'حفظ التغيرات' }}</button></div>
        </form>
        <p v-else class="text-center" role="status">جاري التحقق…</p>
      </div>
    </div>
  </div>
</template>
