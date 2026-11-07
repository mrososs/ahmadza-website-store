<script setup lang="ts">
// Port of admin/book/create.blade.php (create + edit). Validation is shared with the server (adminBookSchema).
import { adminBookSchema } from '~~/shared/schemas'

const props = defineProps<{ id?: number }>()
const { publicUrl } = useMediaUrl()

interface Lookups { categories: { id: number; name: string }[]; makers: { id: number; name: string; kind: 'author' | 'reader' | 'writer' }[]; books: { id: number; title: string }[] }
const { data: lookups } = await useFetch<Lookups>('/api/admin/lookups', { server: false, key: 'admin-lookups' })

const form = reactive({
  title: '', kind: 'paid' as 'paid' | 'free', status: 'draft' as 'draft' | 'published' | 'coming_soon' | 'archived',
  price_amount: 0, pages: 0, description_html: '', category_ids: [] as number[],
  author: null as number | null, reader: null as number | null, writer: null as number | null,
  tagsText: '', related_ids: [] as number[],
})
const cover = ref<File | null>(null)
const currentCover = ref<string | null>(null)
const errors = reactive<Record<string, string>>({})
const globalError = ref('')
const saved = ref(false)
const busy = ref(false)
const loading = ref(!!props.id)
interface RecoveryInfo { evidence: Record<string, unknown> | null; provenance: string; readiness: { eligible: boolean; reasons: string[] }; legacyId: number | null; legacyStatusRaw: string | null; legacyCostRaw: string | null; verifiedAt: string | null; media: { media_id: number; name: string; kind: string; migration_status: string; storage_provider: string; is_external: boolean; has_hash: boolean; validated: boolean }[] }
const recovery = ref<RecoveryInfo | null>(null)

if (props.id) {
  try {
    const b = await adminFetch<{
      title: string; kind: 'paid' | 'free'; status: typeof form.status; price_amount: number | string; pages: number; description_html: string | null
      cover_path: string | null; category_ids: number[]; maker_ids: { id: number; role: string }[]; tags: string[]; related_ids: number[]
      provenance: string; recovery_evidence: Record<string, unknown> | null; legacy_id: number | null; legacy_status_raw: string | null; legacy_cost_raw: string | null; legacy_verified_at: string | null
      readiness: RecoveryInfo['readiness']; media_readiness: RecoveryInfo['media']
    }>(`/api/admin/books/${props.id}`)
    Object.assign(form, {
      title: b.title, kind: b.kind, status: b.status, price_amount: Number(b.price_amount), pages: b.pages, description_html: b.description_html ?? '',
      category_ids: b.category_ids, tagsText: b.tags.join('، '), related_ids: b.related_ids,
      author: b.maker_ids.find((m) => m.role === 'author')?.id ?? null, reader: b.maker_ids.find((m) => m.role === 'reader')?.id ?? null,
      writer: b.maker_ids.find((m) => m.role === 'writer')?.id ?? null,
    })
    currentCover.value = b.cover_path
    if (b.provenance === 'legacy' || b.provenance === 'recovered_media') recovery.value = { evidence: b.recovery_evidence, provenance: b.provenance, readiness: b.readiness, legacyId: b.legacy_id, legacyStatusRaw: b.legacy_status_raw, legacyCostRaw: b.legacy_cost_raw, verifiedAt: b.legacy_verified_at, media: b.media_readiness }
  } catch (e) { globalError.value = (e as Error).message } finally { loading.value = false }
}

const opts = (role: 'author' | 'reader' | 'writer') => (lookups.value?.makers ?? []).filter((m) => m.kind === role).map((m) => ({ value: m.id, label: m.name }))
watch(() => form.kind, (k) => { if (k === 'free') form.price_amount = 0 })

async function verifyBook() {
  if (!props.id || !window.confirm('هل راجعت هذا السجل وتؤكد أنه أصلي؟ (لن يتم نشر الكتاب بهذه الخطوة)')) return
  globalError.value = ''
  try {
    await adminFetch(`/api/admin/books/${props.id}/verify`, { method: 'POST' })
    const b = await adminFetch<{ readiness: RecoveryInfo['readiness']; media_readiness: RecoveryInfo['media']; legacy_verified_at: string | null }>(`/api/admin/books/${props.id}`)
    if (recovery.value) recovery.value = { ...recovery.value, readiness: b.readiness, media: b.media_readiness, verifiedAt: b.legacy_verified_at }
  } catch (e) { globalError.value = (e as Error).message }
}

/** Reject a recovered record: the existing audited soft delete. It moves to the trash and can be restored from there; nothing is destroyed. */
async function rejectBook() {
  if (!props.id || !window.confirm('رفض هذا السجل المستعاد؟ سيُنقل إلى المهملات ويمكن استعادته لاحقاً.')) return
  globalError.value = ''
  try {
    await adminFetch(`/api/admin/books/${props.id}`, { method: 'DELETE' })
    await navigateTo('/admin/books')
  } catch (e) { globalError.value = (e as Error).message }
}

async function submit() {
  Object.keys(errors).forEach((k) => delete errors[k])
  globalError.value = ''
  saved.value = false
  const payload = {
    title: form.title, description_html: form.description_html, kind: form.kind, status: form.status,
    price_amount: Number(form.price_amount) || 0, pages: Number(form.pages) || 0, category_ids: form.category_ids,
    maker_ids: [['author', form.author], ['reader', form.reader], ['writer', form.writer]].filter(([, v]) => v).map(([role, id]) => ({ id: id as number, role: role as 'author' | 'reader' | 'writer' })),
    tags: form.tagsText.split(/[,،\n]/).map((t) => t.trim()).filter(Boolean),
  }
  const parsed = adminBookSchema.safeParse(payload)
  if (!parsed.success) {
    for (const i of parsed.error.issues) errors[String(i.path[0] ?? 'form')] ??= i.message
    void scrollToFirstError()
    return
  }
  busy.value = true
  try {
    const body = { ...parsed.data, related_ids: form.related_ids }
    let id = props.id
    if (id) await adminFetch(`/api/admin/books/${id}`, { method: 'PUT', body })
    else id = (await adminFetch<{ id: number }>('/api/admin/books', { method: 'POST', body })).id
    if (cover.value) {
      const fd = new FormData(); fd.set('file', cover.value)
      const r = await adminFetch<{ path: string }>(`/api/admin/images/books/${id}`, { method: 'POST', body: fd })
      currentCover.value = r.path; cover.value = null
    }
    if (props.id) saved.value = true
    else await navigateTo(`/admin/books/${id}/media`)
  } catch (e) { globalError.value = (e as Error).message } finally { busy.value = false }
}
</script>

<template>
  <div v-if="loading" class="text-center p-5" role="status"><i class="fa fa-spinner fa-spin" /> جاري التحميل…</div>
  <form v-else novalidate @submit.prevent="submit">
    <div class="row justify-content-center">
      <div class="col-12 text-right"><NuxtLink to="/admin/makers/create" target="_blank" class="text-info">إضافة مؤلف جديد</NuxtLink></div>
      <div class="col-lg-10 col-12">
        <AdminRecoveryPanel v-if="recovery" v-bind="recovery" can-verify can-reject @verify="verifyBook" @reject="rejectBook" />
        <div v-if="globalError" class="alert alert-danger" role="alert">{{ globalError }}</div>
        <div v-if="saved" class="alert alert-success" role="status">تم الحفظ بنجاح</div>
        <div class="form-layout">
          <div class="row">
            <div class="col-md-8"><AdminFormField label="إسم الكتاب" required :error="errors.title" for="b-title"><input id="b-title" v-model="form.title" class="form-control" placeholder="إسم الكتاب"></AdminFormField></div>
            <div class="col-md-4"><AdminFormField label="القسم"><AdminSelect v-model="form.category_ids as never" multiple live title="أختر القسم" :options="(lookups?.categories ?? []).map((c) => ({ value: c.id, label: c.name }))" /></AdminFormField></div>
            <div class="col-lg-4 col-md-6"><AdminFormField label="النوع" required><AdminSelect v-model="form.kind as never" title="أختر النوع" :options="[{ value: 'paid', label: 'مدفوع' }, { value: 'free', label: 'مجانى' }]" /></AdminFormField></div>
            <div class="col-lg-4 col-md-6"><AdminFormField label="التكلفة" :error="errors.price_amount" for="b-cost"><input id="b-cost" v-model.number="form.price_amount" type="number" step="0.01" min="0" :disabled="form.kind === 'free'" class="form-control" placeholder="التكلفة"></AdminFormField></div>
            <div class="col-lg-4 col-md-6"><AdminFormField label="العملة"><AdminSelect :model-value="'USD'" title="أختر العملة" :options="[{ value: 'USD', label: 'دولار' }]" /></AdminFormField></div>
            <div class="col-lg-4 col-md-6"><AdminFormField label="المؤلف"><AdminSelect v-model="form.author as never" live title="أختر المؤلف" :options="opts('author')" /></AdminFormField></div>
            <div class="col-lg-4 col-md-6"><AdminFormField label="القارئ"><AdminSelect v-model="form.reader as never" live title="أختر القارئ" :options="opts('reader')" /></AdminFormField></div>
            <div class="col-lg-4 col-md-6"><AdminFormField label="المنسق"><AdminSelect v-model="form.writer as never" live title="أختر المنسق" :options="opts('writer')" /></AdminFormField></div>
            <div class="col-lg-4 col-md-6">
              <AdminFormField label="الحالة" required>
                <AdminSelect v-model="form.status as never" title="أختر الحالة" :options="[{ value: 'draft', label: 'غير مفعلة' }, { value: 'published', label: 'مفعلة' }, { value: 'coming_soon', label: 'قريباً' }, { value: 'archived', label: 'مؤرشفة' }]" />
              </AdminFormField>
            </div>
            <div class="col-12">
              <AdminFormField label="الغلاف ( png,jpg,jpeg,webp ) && أقصى حجم 2.00 ميجا - 635 x 952 بيكسل">
                <img v-if="currentCover && !cover" :src="publicUrl(currentCover)" alt="الغلاف الحالي" style="height: 80px" class="mb-2 d-block">
                <AdminFileDrop accept="image/png,image/jpeg,image/webp" :height="50" :max-bytes="2097152" @file="cover = $event" />
              </AdminFormField>
            </div>
            <div class="col-12"><AdminFormField label="الكلمات المفتاحية" hint="افصل بين الكلمات بفاصلة"><textarea v-model="form.tagsText" class="form-control" placeholder="الكلمات المفتاحية" /></AdminFormField></div>
            <div class="col-12">
              <AdminFormField label="الكتب المتشابهة">
                <AdminSelect v-model="form.related_ids as never" multiple live title="أختر الكتب المتشابهة" :options="(lookups?.books ?? []).filter((b) => b.id !== id).map((b) => ({ value: b.id, label: b.title }))" />
              </AdminFormField>
            </div>
            <div class="col-12">
              <AdminFormField label="حول الكتاب" hint="HTML بسيط مسموح — يتم تنظيف المحتوى على الخادم عند الحفظ">
                <textarea v-model="form.description_html" class="tw_editor form-control" rows="8" dir="auto" />
              </AdminFormField>
            </div>
          </div>
          <div class="text-right"><button class="button" type="submit" :disabled="busy"><i v-if="busy" class="fa fa-spinner fa-spin" /> حفظ</button></div>
        </div>
      </div>
    </div>
    <br>
  </form>
</template>
