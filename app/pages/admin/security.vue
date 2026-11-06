<script setup lang="ts">
// Administrator two-step verification (TOTP, Supabase Auth). Enrol an authenticator app, or enter the current code to finish signing in.
// The server enforces the result: /api/admin/** answers 403 mfa_required until this session reaches assurance level aal2.
definePageMeta({ layout: 'admin-blank', middleware: ['admin'] })
useHead({ title: 'التحقق بخطوتين' })

interface Factor { id: string; friendly_name?: string | null; status: string }
const client = useSupabaseClient()
const satisfied = useState<boolean>('admin-mfa-satisfied', () => false)
const loading = ref(true)
const busy = ref(false)
const error = ref('')
const notice = ref('')
const factors = ref<Factor[]>([])
const aal = ref<'aal1' | 'aal2' | null>(null)
const enrol = ref<{ id: string; qr: string; secret: string } | null>(null)
const code = ref('')

const verified = computed(() => factors.value.filter((f) => f.status === 'verified'))
const mode = computed<'enrol' | 'verify' | 'done'>(() => (aal.value === 'aal2' ? 'done' : verified.value.length ? 'verify' : 'enrol'))

async function load() {
  loading.value = true
  const [f, a] = await Promise.all([client.auth.mfa.listFactors(), client.auth.mfa.getAuthenticatorAssuranceLevel()])
  factors.value = (f.data?.all ?? []).filter((x) => x.factor_type === 'totp') as Factor[]
  aal.value = (a.data?.currentLevel as 'aal1' | 'aal2' | null) ?? null
  if (aal.value === 'aal2') satisfied.value = true
  loading.value = false
}
onMounted(load)

const clean = (c: string) => c.replace(/\s+/g, '')
const badCode = () => { if (!/^\d{6}$/.test(clean(code.value))) { error.value = 'أدخل الرمز المكوّن من 6 أرقام'; return true } return false }

async function startEnrol() {
  error.value = ''; notice.value = ''; busy.value = true
  try {
    for (const f of factors.value.filter((x) => x.status !== 'verified')) await client.auth.mfa.unenroll({ factorId: f.id }) // a half-finished earlier attempt
    const r = await client.auth.mfa.enroll({ factorType: 'totp', friendlyName: `AAWRAQ ${new Date().toISOString().slice(0, 10)}` })
    if (r.error || !r.data) { error.value = 'تعذر بدء التفعيل، حاول مرة أخرى'; return }
    enrol.value = { id: r.data.id, qr: r.data.totp.qr_code, secret: r.data.totp.secret }
  } finally { busy.value = false }
}

async function confirm(factorId: string) {
  error.value = ''
  if (badCode()) return
  busy.value = true
  try {
    const ch = await client.auth.mfa.challenge({ factorId })
    if (ch.error) { error.value = 'تعذر بدء التحقق، حاول مرة أخرى'; return }
    const v = await client.auth.mfa.verify({ factorId, challengeId: ch.data.id, code: clean(code.value) })
    if (v.error) { error.value = 'الرمز غير صحيح أو منتهي'; code.value = ''; return }
    satisfied.value = true
    enrol.value = null; code.value = ''
    await navigateTo('/admin')
  } finally { busy.value = false }
}

async function remove(f: Factor) {
  if (!window.confirm('إزالة التحقق بخطوتين تجعل الحساب أقل حماية. هل تريد المتابعة؟')) return
  error.value = ''; busy.value = true
  try {
    const r = await client.auth.mfa.unenroll({ factorId: f.id })
    if (r.error) { error.value = 'تعذرت الإزالة. سجّل الدخول من جديد ثم أعد المحاولة.'; return }
    satisfied.value = false
    notice.value = 'تمت إزالة التحقق بخطوتين. ستُطلب منك إعادته عند الدخول التالي.'
    await load()
  } finally { busy.value = false }
}
</script>

<template>
  <section class="height-100vh d-flex align-items-center page-section-ptb login">
    <div class="container">
      <div class="row justify-content-center no-gutters vertical-align">
        <div class="col-lg-5 col-md-8 bg-white p-4">
          <h5 class="mb-3"><i class="fa fa-shield" aria-hidden="true" /> التحقق بخطوتين</h5>
          <div v-if="loading" class="text-center p-4" role="status"><i class="fa fa-spinner fa-spin" /> جاري التحميل…</div>
          <template v-else>
            <div v-if="error" class="alert alert-danger" role="alert">{{ error }}</div>
            <div v-if="notice" class="alert alert-success" role="status">{{ notice }}</div>

            <template v-if="mode === 'enrol'">
              <p>لحماية لوحة التحكم، يلزم تفعيل التحقق بخطوتين باستخدام تطبيق مصادقة على هاتفك (مثل Google Authenticator أو Microsoft Authenticator).</p>
              <button v-if="!enrol" type="button" class="button" :disabled="busy" @click="startEnrol"><i v-if="busy" class="fa fa-spinner fa-spin" /> بدء التفعيل</button>
              <form v-else novalidate @submit.prevent="confirm(enrol!.id)">
                <ol class="pr-3">
                  <li>امسح الرمز في تطبيق المصادقة:<div class="text-center my-3"><img :src="enrol.qr" alt="رمز QR لتفعيل التحقق بخطوتين" width="180" height="180"></div></li>
                  <li>أو أدخل هذا المفتاح يدوياً: <code dir="ltr" class="d-block text-left">{{ enrol.secret }}</code></li>
                  <li>أدخل الرمز الذي يعرضه التطبيق لإتمام التفعيل:</li>
                </ol>
                <input v-model="code" class="web form-control mb-3" inputmode="numeric" autocomplete="one-time-code" maxlength="7" dir="ltr" placeholder="000000" aria-label="رمز التحقق">
                <button class="button" :disabled="busy"><i v-if="busy" class="fa fa-spinner fa-spin" /> تفعيل</button>
              </form>
            </template>

            <form v-else-if="mode === 'verify'" novalidate @submit.prevent="confirm(verified[0]!.id)">
              <p>أدخل الرمز المكوّن من 6 أرقام من تطبيق المصادقة لإكمال تسجيل الدخول.</p>
              <input v-model="code" class="web form-control mb-3" inputmode="numeric" autocomplete="one-time-code" maxlength="7" dir="ltr" placeholder="000000" aria-label="رمز التحقق" autofocus>
              <button class="button" :disabled="busy"><i v-if="busy" class="fa fa-spinner fa-spin" /> تحقق</button>
            </form>

            <template v-else>
              <p class="text-success"><i class="fa fa-check-circle" aria-hidden="true" /> التحقق بخطوتين مفعّل وتم تأكيده في هذه الجلسة.</p>
              <ul class="list-unstyled">
                <li v-for="f in verified" :key="f.id" class="mb-2">
                  {{ f.friendly_name || 'تطبيق مصادقة' }}
                  <button type="button" class="btn btn-sm btn-outline-danger mr-2" :disabled="busy" @click="remove(f)">إزالة</button>
                </li>
              </ul>
              <NuxtLink to="/admin" class="button">العودة إلى لوحة التحكم</NuxtLink>
            </template>
          </template>
        </div>
      </div>
    </div>
  </section>
</template>
