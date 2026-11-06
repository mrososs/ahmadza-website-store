<script setup lang="ts">
// Port of admin/login.blade.php. Supabase Auth e-mail + password, then the DATABASE role (is_admin) is verified;
// a non-admin is signed out immediately with a clear refusal. An administrator with an enrolled authenticator app is then asked for the 6-digit code
// (assurance level aal1 -> aal2). No credentials are seeded or stored.
import { loginSchema } from '~~/shared/schemas'

definePageMeta({ layout: 'admin-blank' })
useHead({ title: 'تسجيل الدخول' })

const client = useSupabaseClient()
const form = reactive({ email: '', password: '' })
const error = ref('')
const busy = ref(false)
const step = ref<'password' | 'code'>('password')
const code = ref('')
let factorId = ''
const satisfied = useState<boolean>('admin-mfa-satisfied', () => false)

async function submit() {
  error.value = ''
  const parsed = loginSchema.safeParse(form)
  if (!parsed.success) { error.value = parsed.error.issues[0]?.message ?? 'بيانات غير صالحة'; return }
  busy.value = true
  try {
    const { error: authError } = await client.auth.signInWithPassword(parsed.data)
    if (authError) { error.value = 'البريد الإلكتروني أو كلمة المرور غير صحيحة'; return }
    const { data: isAdmin } = await client.rpc('is_admin')
    if (isAdmin !== true) {
      await client.auth.signOut()
      error.value = 'هذا الحساب ليس لديه صلاحية الدخول إلى لوحة التحكم'
      return
    }
    satisfied.value = false
    const { data: aal } = await client.auth.mfa.getAuthenticatorAssuranceLevel()
    if (aal?.nextLevel === 'aal2' && aal.currentLevel !== 'aal2') {
      const { data: f } = await client.auth.mfa.listFactors()
      factorId = f?.totp?.[0]?.id ?? ''
      if (factorId) { step.value = 'code'; return }
    }
    await navigateTo('/admin') // the route middleware sends an admin who must enrol a second factor to /admin/security
  } finally { busy.value = false }
}

async function verifyCode() {
  error.value = ''
  if (!/^\d{6}$/.test(code.value.trim())) { error.value = 'أدخل الرمز المكوّن من 6 أرقام'; return }
  busy.value = true
  try {
    const ch = await client.auth.mfa.challenge({ factorId })
    if (ch.error) { error.value = 'تعذر بدء التحقق، حاول مرة أخرى'; return }
    const v = await client.auth.mfa.verify({ factorId, challengeId: ch.data.id, code: code.value.trim() })
    if (v.error) { error.value = 'الرمز غير صحيح أو منتهي'; code.value = ''; return }
    satisfied.value = true
    await navigateTo('/admin')
  } finally { busy.value = false }
}
</script>

<template>
  <section class="height-100vh d-flex align-items-center page-section-ptb login">
    <div class="container">
      <div class="row justify-content-center no-gutters vertical-align">
        <div class="col-lg-4 col-md-6 bg-white">
          <form v-if="step === 'code'" class="p-0" novalidate @submit.prevent="verifyCode">
            <div class="login-fancy pb-40 clearfix">
              <div v-if="error" class="alert alert-danger" role="alert">{{ error }}</div>
              <p class="mb-20">أدخل الرمز المكوّن من 6 أرقام من تطبيق المصادقة على هاتفك.</p>
              <div class="section-field mb-20">
                <label class="mb-10" for="admin-code">رمز التحقق</label>
                <input id="admin-code" v-model="code" class="web form-control" inputmode="numeric" autocomplete="one-time-code" maxlength="6" dir="ltr" placeholder="000000" autofocus>
              </div>
              <div class="text-center"><button class="button" :disabled="busy"><i class="fa" :class="busy ? 'fa-spinner fa-spin' : 'fa-shield'" /><span>تحقق</span></button></div>
            </div>
          </form>
          <form v-else class="p-0" novalidate @submit.prevent="submit">
            <div class="login-fancy pb-40 clearfix">
              <div v-if="error" class="alert alert-danger" role="alert">{{ error }}</div>
              <div class="section-field mb-20">
                <label class="mb-10" for="admin-email">البريد الإلكترونى</label>
                <input id="admin-email" v-model="form.email" class="web form-control" type="email" autocomplete="username" placeholder="البريد الإلكترونى" name="email">
              </div>
              <div class="section-field mb-20">
                <label class="mb-10" for="admin-password">كلمة المرور</label>
                <input id="admin-password" v-model="form.password" class="Password form-control" type="password" autocomplete="current-password" placeholder="كلمة المرور" name="password">
              </div>
              <div class="text-center">
                <button class="button" :disabled="busy">
                  <i class="fa" :class="busy ? 'fa-spinner fa-spin' : 'fa-lock'" />
                  <span>الدخول</span>
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  </section>
</template>
