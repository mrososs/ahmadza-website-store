<script setup lang="ts">
// Port of admin/site-info/index.blade.php (ADM-10) + branding uploads. Commercial parameters carry the
// "pending owner confirmation" notice (docs/legacy-audit/16): the legacy defaults are NOT confirmed live values.
import { adminSettingsFullSchema } from '~~/shared/schemas/admin'

definePageMeta({ layout: 'admin', middleware: ['admin'] })
useAdminTitle('معلومات الموقع')
const { publicUrl } = useMediaUrl()

type S = Record<string, string | number | boolean | string[] | null>
const { data, error, refresh } = await useFetch<S>('/api/admin/settings', { server: false, key: 'admin-settings' })
const f = reactive<Record<string, string | number | boolean | null>>({})
watch(data, (d) => { if (d) Object.assign(f, d) }, { immediate: true })

const errors = reactive<Record<string, string>>({})
const msg = reactive({ ok: '', err: '' })
const busy = ref(false)
const files = reactive<Record<string, File | null>>({ logo: null, poster: null, poster_mobile: null })

const PENDING_LABEL: Record<string, string> = {
  affiliate_commission_percent: 'نسبة عمولة المسوّق', commission_freeze_days: 'أيام تجميد الأرباح', min_withdrawal_amount: 'الحد الأدنى للسحب',
  gateway: 'بوابة الدفع الفعلية', fx_rate: 'سعر الصرف',
}
const pending = computed(() => ((data.value?.pending_owner_confirmation as string[] | undefined) ?? []).map((k) => PENDING_LABEL[k] ?? k))
const yn = [{ value: 1, label: 'عرض' }, { value: 0, label: 'إخفاء' }]
const bool = (k: string) => computed({ get: () => (f[k] ? 1 : 0), set: (v: number) => { f[k] = v === 1 } })
const freeBtn = bool('show_free_book_button'), posterPc = bool('show_poster_desktop'), posterMob = bool('show_poster_mobile'), mfa = bool('require_admin_mfa')

async function submit() {
  Object.keys(errors).forEach((k) => delete errors[k]); msg.ok = ''; msg.err = ''
  const parsed = adminSettingsFullSchema.safeParse({
    ...f, affiliate_commission_percent: Number(f.affiliate_commission_percent), commission_freeze_days: Number(f.commission_freeze_days), min_withdrawal_amount: Number(f.min_withdrawal_amount),
  })
  if (!parsed.success) { for (const i of parsed.error.issues) errors[String(i.path[0])] ??= i.message; return }
  busy.value = true
  try {
    await adminFetch('/api/admin/settings', { method: 'PUT', body: parsed.data })
    for (const [field, file] of Object.entries(files)) {
      if (!file) continue
      const fd = new FormData(); fd.set('file', file)
      await adminFetch(`/api/admin/settings/upload?field=${field}`, { method: 'POST', body: fd })
      files[field] = null
    }
    msg.ok = 'تم حفظ الإعدادات'
    await refresh()
  } catch (e) { msg.err = (e as Error).message } finally { busy.value = false }
}
</script>

<template>
  <div class="container">
    <div v-if="error" class="alert alert-danger" role="alert">{{ adminErrorMessage(error) }} <a href="#" @click.prevent="refresh()">إعادة المحاولة</a></div>
    <div v-else-if="!data" class="text-center p-5" role="status"><i class="fa fa-spinner fa-spin" /> جاري التحميل…</div>
    <form v-else novalidate @submit.prevent="submit">
      <div class="row justify-content-center">
        <div class="col-lg-8 col-12">
          <div v-if="msg.ok" class="alert alert-success" role="status">{{ msg.ok }}</div>
          <div v-if="msg.err" class="alert alert-danger" role="alert">{{ msg.err }}</div>
          <div v-if="pending.length" class="alert alert-warning" role="note">
            <strong>بانتظار تأكيد المالك:</strong> القيم التالية هي قيم افتراضية قديمة وليست قيماً مؤكدة للموقع الفعلي — {{ pending.join('، ') }}.
          </div>
          <div class="form-layout">
            <div class="row">
              <div class="col-lg-6 col-12"><AdminFormField label="أسم الموقع" required :error="errors.site_name"><input v-model="f.site_name as string" class="form-control" placeholder="الأسم"></AdminFormField></div>
              <div class="col-lg-6 col-12"><AdminFormField label="البريد الالكترونى" :error="errors.email"><input v-model="f.email as string" class="form-control" dir="ltr" placeholder="البريد الالكترونى"></AdminFormField></div>
              <div class="col-lg-6 col-12"><AdminFormField label="رابط إظهار الكتب المجانية" required><AdminSelect :model-value="freeBtn" @update:model-value="freeBtn = $event as never" title="أختر الحالة" :options="yn" /></AdminFormField></div>
              <div class="col-lg-6 col-12">
                <AdminFormField label="Payment Mode" required hint="لا تُفعَّل بوابة دفع حقيقية في هذه النسخة (محاكاة محلية فقط)">
                  <AdminSelect v-model="f.payment_mode as never" title="أختر الحالة" :options="[{ value: 'live', label: 'Live Mode' }, { value: 'test', label: 'Test Mode' }]" />
                </AdminFormField>
              </div>
              <div class="col-lg-6 col-12"><AdminFormField label="البوستر (الشاشات الكبيرة)" required><AdminSelect :model-value="posterPc" @update:model-value="posterPc = $event as never" title="أختر الحالة" :options="yn" /></AdminFormField></div>
              <div class="col-lg-6 col-12"><AdminFormField label="البوستر (الموبايل)" required><AdminSelect :model-value="posterMob" @update:model-value="posterMob = $event as never" title="أختر الحالة" :options="yn" /></AdminFormField></div>
              <div class="col-lg-6 col-12"><AdminFormField label="رقم الواتساب"><input v-model="f.whatsapp as string" class="form-control" dir="ltr" placeholder="مثال : 9665512345678"></AdminFormField></div>
              <div class="col-lg-6 col-12"><AdminFormField label="رقم الهاتف"><input v-model="f.phone as string" class="form-control" dir="ltr" placeholder="رقم الهاتف"></AdminFormField></div>
              <div v-for="s in [['facebook', 'رابط الفيسبوك'], ['twitter', 'رابط تويتر'], ['instagram', 'رابط الانستجرام'], ['youtube', 'رابط اليوتيوب'], ['telegram', 'رابط التيليجرام'], ['linkedin', 'رابط لينكدإن']]" :key="s[0]" class="col-lg-6 col-12">
                <AdminFormField :label="s[1]!"><input v-model="f[s[0]!] as string" class="form-control" dir="ltr" :placeholder="s[1]"></AdminFormField>
              </div>
              <div class="col-12"><AdminFormField label="وصف الموقع"><textarea v-model="f.description as string" class="form-control" rows="2" /></AdminFormField></div>
              <div class="col-12"><AdminFormField label="الكلمات المفتاحية"><textarea v-model="f.keywords as string" class="form-control" rows="2" /></AdminFormField></div>

              <div class="col-12"><h6 class="mt-3">التسويق بالعمولة والسحب <span class="badge badge-warning">بانتظار تأكيد المالك</span></h6></div>
              <div class="col-lg-4 col-12"><AdminFormField label="نسبة العمولة %" :error="errors.affiliate_commission_percent"><input v-model="f.affiliate_commission_percent as number" type="number" step="0.01" min="0" max="100" class="form-control"></AdminFormField></div>
              <div class="col-lg-4 col-12"><AdminFormField label="أيام التجميد" :error="errors.commission_freeze_days"><input v-model="f.commission_freeze_days as number" type="number" min="0" max="365" class="form-control"></AdminFormField></div>
              <div class="col-lg-4 col-12"><AdminFormField label="الحد الأدنى للسحب" :error="errors.min_withdrawal_amount"><input v-model="f.min_withdrawal_amount as number" type="number" step="0.01" min="0" class="form-control"></AdminFormField></div>

              <div class="col-12"><h6 class="mt-3">الأمان</h6></div>
              <div class="col-lg-6 col-12">
                <AdminFormField label="اشتراط التحقق بخطوتين للمدير (MFA)" hint="تحذير: التفعيل يمنع دخول المدير بدون جلسة AAL2؛ واجهة تسجيل TOTP غير متوفرة بعد.">
                  <AdminSelect :model-value="mfa" @update:model-value="mfa = $event as never" title="أختر الحالة" :options="[{ value: 1, label: 'مطلوب' }, { value: 0, label: 'غير مطلوب' }]" />
                </AdminFormField>
              </div>

              <div class="col-12"><h6 class="mt-3">الصور</h6></div>
              <div class="col-lg-4 col-12">
                <AdminFormField label="الشعار (Logo)"><img v-if="data.logo_path" :src="publicUrl(data.logo_path as string)" alt="الشعار الحالي" style="height: 50px" class="mb-2 d-block"><AdminFileDrop accept="image/png,image/jpeg,image/webp" :height="50" :max-bytes="2097152" @file="files.logo = $event" /></AdminFormField>
              </div>
              <div class="col-lg-4 col-12">
                <AdminFormField label="البوستر (كبير)"><img v-if="data.poster_path" :src="publicUrl(data.poster_path as string)" alt="البوستر الحالي" style="height: 50px" class="mb-2 d-block"><AdminFileDrop accept="image/png,image/jpeg,image/webp" :height="50" :max-bytes="2097152" @file="files.poster = $event" /></AdminFormField>
              </div>
              <div class="col-lg-4 col-12">
                <AdminFormField label="البوستر (موبايل)"><img v-if="data.poster_mobile_path" :src="publicUrl(data.poster_mobile_path as string)" alt="بوستر الموبايل الحالي" style="height: 50px" class="mb-2 d-block"><AdminFileDrop accept="image/png,image/jpeg,image/webp" :height="50" :max-bytes="2097152" @file="files.poster_mobile = $event" /></AdminFormField>
              </div>
            </div>
            <div class="text-right"><button class="button" type="submit" :disabled="busy"><i v-if="busy" class="fa fa-spinner fa-spin" /> حفظ</button></div>
          </div>
        </div>
      </div>
      <br>
    </form>
  </div>
</template>
