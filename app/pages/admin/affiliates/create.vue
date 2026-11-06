<script setup lang="ts">
// resources/views/affiliate/admin/create.blade.php — legacy created a user with a generated password.
// Here the admin promotes an EXISTING, registered customer by e-mail: no password is generated, stored or e-mailed.
definePageMeta({ layout: 'admin', middleware: ['admin'] })
useAdminTitle('أضافة مسوق جديد')

const email = ref('')
const busy = ref(false)
const failure = ref('')

async function save() {
  failure.value = ''
  busy.value = true
  try {
    const r = await $fetch<{ id: string }>('/api/admin/affiliates', { method: 'POST', body: { email: email.value } })
    await navigateTo(`/admin/affiliates/${r.id}`)
  } catch (e) { failure.value = partnerErrorMessage(e) } finally { busy.value = false }
}
</script>

<template>
  <div class="row justify-content-center">
    <div class="col-xl-8">
      <form id="register_form" class="wp_form" novalidate @submit.prevent="save">
        <div v-if="failure" class="alert alert-danger" role="alert">{{ failure }}</div>
        <div class="row">
          <div class="col-sm-12">
            <div class="form-group">
              <label for="aff-email">البريد الإلكترونى للعميل المسجّل</label>
              <input id="aff-email" v-model="email" type="email" placeholder="البريد الإلكترونى" class="form-control" name="email" autocomplete="off" dir="ltr">
              <small class="text-muted">يجب أن يكون للعميل حساب مسجّل مسبقاً. لا يتم إنشاء كلمة مرور أو إرسالها.</small>
            </div>
          </div>
          <div class="col-12">
            <div class="form-group text-right">
              <button type="submit" class="button" :disabled="busy">حفظ</button>
            </div>
          </div>
        </div>
      </form>
    </div>
  </div>
</template>
