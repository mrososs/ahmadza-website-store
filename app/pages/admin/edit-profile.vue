<script setup lang="ts">
// Port of admin/edit-profile.blade.php: the admin changes their OWN e-mail / password through Supabase Auth
// (user session; no server-side privilege involved). Password changes require re-entering the current password.
import { z } from 'zod'

definePageMeta({ layout: 'admin', middleware: ['admin'] })
useAdminTitle('بيانات الدخول')

const client = useSupabaseClient()
const user = useSupabaseUser()
const form = reactive({ email: '', current: '', password: '', confirm: '' })
const msg = reactive({ ok: '', err: '' })
const busy = ref(false)
watchEffect(() => { if (!form.email) form.email = (user.value as { email?: string } | null)?.email ?? '' })

const schema = z.object({
  email: z.string().trim().toLowerCase().email('البريد الإلكتروني غير صالح'),
  current: z.string().min(1, 'كلمة المرور الحالية مطلوبة'),
  password: z.string().min(8, 'كلمة المرور 8 أحرف على الأقل').max(128).or(z.literal('')),
  confirm: z.string(),
}).refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'كلمتا المرور غير متطابقتين' })

async function submit() {
  msg.ok = ''; msg.err = ''
  const p = schema.safeParse(form)
  if (!p.success) { msg.err = p.error.issues[0]?.message ?? 'بيانات غير صالحة'; return }
  busy.value = true
  try {
    const currentEmail = (user.value as { email?: string } | null)?.email ?? ''
    const re = await client.auth.signInWithPassword({ email: currentEmail, password: p.data.current })
    if (re.error) { msg.err = 'كلمة المرور الحالية غير صحيحة'; return }
    const attrs: { email?: string; password?: string } = {}
    if (p.data.email !== currentEmail) attrs.email = p.data.email
    if (p.data.password) attrs.password = p.data.password
    if (!Object.keys(attrs).length) { msg.ok = 'لا توجد تغييرات'; return }
    const { error } = await client.auth.updateUser(attrs)
    if (error) { msg.err = error.message; return }
    msg.ok = attrs.email ? 'تم الحفظ — تحقق من بريدك لتأكيد البريد الجديد' : 'تم تحديث كلمة المرور'
    Object.assign(form, { current: '', password: '', confirm: '' })
  } finally { busy.value = false }
}
</script>

<template>
  <form novalidate @submit.prevent="submit">
    <div class="row justify-content-center">
      <div class="col-lg-6 col-12">
        <div v-if="msg.ok" class="alert alert-success" role="status">{{ msg.ok }}</div>
        <div v-if="msg.err" class="alert alert-danger" role="alert">{{ msg.err }}</div>
        <div class="form-layout">
          <AdminFormField label="البريد الالكترونى" required for="p-email"><input id="p-email" v-model="form.email" type="email" class="form-control" dir="ltr" autocomplete="username"></AdminFormField>
          <AdminFormField label="كلمة المرور الحالية" required for="p-cur"><input id="p-cur" v-model="form.current" type="password" class="form-control" autocomplete="current-password"></AdminFormField>
          <AdminFormField label="كلمة المرور الجديدة" hint="اتركها فارغة إذا لم ترد تغييرها" for="p-new"><input id="p-new" v-model="form.password" type="password" class="form-control" autocomplete="new-password"></AdminFormField>
          <AdminFormField label="تأكيد كلمة المرور" for="p-conf"><input id="p-conf" v-model="form.confirm" type="password" class="form-control" autocomplete="new-password"></AdminFormField>
          <div class="text-right"><button class="button" type="submit" :disabled="busy"><i v-if="busy" class="fa fa-spinner fa-spin" /> حفظ</button></div>
        </div>
      </div>
    </div>
  </form>
</template>
