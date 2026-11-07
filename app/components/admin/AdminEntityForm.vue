<script setup lang="ts">
// Create / edit form for categories, makers, articles and pages (ports of admin/{category,maker,article,page}/create.blade.php).
import { adminArticleSchema, adminCategorySchema, adminMakerSchema, adminPageSchema } from '~~/shared/schemas'

type Entity = 'categories' | 'makers' | 'articles' | 'pages'
const props = defineProps<{ entity: Entity; id?: number }>()
const { publicUrl } = useMediaUrl()

const form = reactive({
  name: '', title: '', slug: '', is_active: true, kind: 'author', era: 'new', bio_html: '', excerpt: '', content_html: '',
  status: 'draft', positions: [] as string[], articleKind: 'article',
})
const image = ref<File | null>(null)
const currentImage = ref<string | null>(null)
const errors = reactive<Record<string, string>>({})
const globalError = ref('')
const saved = ref(false)
const busy = ref(false)
const loading = ref(!!props.id)
const hasImage = computed(() => props.entity !== 'pages')

if (props.id) {
  try {
    const r = await adminFetch<Record<string, unknown>>(`/api/admin/${props.entity}/${props.id}`)
    form.name = String(r.name ?? ''); form.title = String(r.title ?? ''); form.slug = String(r.slug ?? '')
    form.is_active = r.is_active !== false
    form.kind = String(r.kind ?? form.kind); form.era = String(r.era ?? form.era)
    form.bio_html = String(r.bio_html ?? ''); form.excerpt = String(r.excerpt ?? ''); form.content_html = String(r.content_html ?? '')
    form.status = String(r.status ?? form.status); form.positions = (r.positions as string[]) ?? []
    if (props.entity === 'articles') form.articleKind = String(r.kind ?? 'article')
    currentImage.value = (r.image_path ?? r.poster_path ?? null) as string | null
  } catch (e) { globalError.value = (e as Error).message } finally { loading.value = false }
}

function payload() {
  switch (props.entity) {
    case 'categories': return adminCategorySchema.safeParse({ name: form.name, is_active: form.is_active })
    case 'makers': return adminMakerSchema.safeParse({ name: form.name, kind: form.kind, era: form.era, bio_html: form.bio_html, is_active: form.is_active })
    case 'articles': return adminArticleSchema.safeParse({ kind: form.articleKind, title: form.title, excerpt: form.excerpt, content_html: form.content_html, status: form.status })
    default: return adminPageSchema.safeParse({ slug: form.slug, title: form.title, content_html: form.content_html, positions: form.positions, status: form.status })
  }
}

async function submit() {
  Object.keys(errors).forEach((k) => delete errors[k])
  globalError.value = ''; saved.value = false
  const parsed = payload()
  if (!parsed.success) { for (const i of parsed.error.issues) errors[String(i.path[0] ?? 'form')] ??= i.message; void scrollToFirstError(); return }
  busy.value = true
  try {
    let id = props.id
    if (id) await adminFetch(`/api/admin/${props.entity}/${id}`, { method: 'PUT', body: parsed.data })
    else id = (await adminFetch<{ id: number }>(`/api/admin/${props.entity}`, { method: 'POST', body: parsed.data })).id
    if (image.value && hasImage.value) {
      const fd = new FormData(); fd.set('file', image.value)
      currentImage.value = (await adminFetch<{ path: string }>(`/api/admin/images/${props.entity}/${id}`, { method: 'POST', body: fd })).path
      image.value = null
    }
    if (props.id) saved.value = true
    else await navigateTo(`/admin/${props.entity}`)
  } catch (e) { globalError.value = (e as Error).message } finally { busy.value = false }
}
const togglePos = (p: string) => { form.positions = form.positions.includes(p) ? form.positions.filter((x) => x !== p) : [...form.positions, p] }
const statusOptions = computed(() => props.entity === 'categories' || props.entity === 'makers'
  ? [{ value: 'inactive', label: 'غير مفعلة' }, { value: 'active', label: 'مفعلة' }]
  : [{ value: 'draft', label: 'غير مفعلة' }, { value: 'published', label: 'مفعلة' }, { value: 'archived', label: 'مؤرشفة' }])
const statusModel = computed({
  get: () => (props.entity === 'categories' || props.entity === 'makers' ? (form.is_active ? 'active' : 'inactive') : form.status),
  set: (v: string) => { if (props.entity === 'categories' || props.entity === 'makers') form.is_active = v === 'active'; else form.status = v },
})
</script>

<template>
  <div v-if="loading" class="text-center p-5" role="status"><i class="fa fa-spinner fa-spin" /> جاري التحميل…</div>
  <form v-else novalidate @submit.prevent="submit">
    <div class="row justify-content-center">
      <div class="col-lg-10 col-12">
        <div v-if="globalError" class="alert alert-danger" role="alert">{{ globalError }}</div>
        <div v-if="saved" class="alert alert-success" role="status">تم الحفظ بنجاح</div>
        <div class="form-layout">
          <div class="row">
            <div v-if="entity === 'categories' || entity === 'makers'" class="col-md-6">
              <AdminFormField :label="entity === 'categories' ? 'عنوان القسم' : 'الأسم'" required :error="errors.name" for="e-name"><input id="e-name" v-model="form.name" class="form-control" placeholder="الاسم"></AdminFormField>
            </div>
            <div v-else class="col-md-6">
              <AdminFormField label="العنوان" required :error="errors.title" for="e-title"><input id="e-title" v-model="form.title" class="form-control" placeholder="العنوان"></AdminFormField>
            </div>
            <div class="col-md-6"><AdminFormField label="الحالة"><AdminSelect :model-value="statusModel" @update:model-value="statusModel = $event as never" title="أختر الحالة" :options="statusOptions" /></AdminFormField></div>

            <template v-if="entity === 'makers'">
              <div class="col-md-6"><AdminFormField label="النوع"><AdminSelect v-model="form.kind as never" title="أختر النوع" :options="[{ value: 'author', label: 'مؤلف' }, { value: 'reader', label: 'قارئ' }, { value: 'writer', label: 'كاتب' }]" /></AdminFormField></div>
              <div class="col-md-6"><AdminFormField label="العصر"><AdminSelect v-model="form.era as never" title="أختر العصر" :options="[{ value: 'old', label: 'قديم' }, { value: 'new', label: 'حديث' }]" /></AdminFormField></div>
              <div class="col-12"><AdminFormField label="نبذة" hint="HTML بسيط مسموح — يتم تنظيفه على الخادم"><textarea v-model="form.bio_html" class="form-control tw_editor" rows="6" dir="auto" /></AdminFormField></div>
            </template>

            <template v-if="entity === 'pages'">
              <div class="col-md-6"><AdminFormField label="الرابط (slug)" required :error="errors.slug" for="e-slug" hint="يظهر في /p/..."><input id="e-slug" v-model="form.slug" class="form-control" dir="ltr" placeholder="terms"></AdminFormField></div>
              <div class="col-md-6">
                <AdminFormField label="مكان الظهور">
                  <div class="checkbox-inline">
                    <label class="mr-3"><input type="checkbox" :checked="form.positions.includes('header')" @change="togglePos('header')"> الهيدر</label>
                    <label><input type="checkbox" :checked="form.positions.includes('footer')" @change="togglePos('footer')"> الفوتر</label>
                  </div>
                </AdminFormField>
              </div>
            </template>

            <template v-if="entity === 'articles'">
              <div class="col-md-6"><AdminFormField label="النوع"><AdminSelect v-model="form.articleKind as never" title="النوع" :options="[{ value: 'article', label: 'مقال' }, { value: 'video', label: 'فيديو' }, { value: 'ads', label: 'إعلان' }]" /></AdminFormField></div>
              <div class="col-12"><AdminFormField label="مقتطف"><textarea v-model="form.excerpt" class="form-control" rows="2" dir="auto" /></AdminFormField></div>
            </template>
            <div v-if="entity === 'articles' || entity === 'pages'" class="col-12">
              <AdminFormField label="المحتوى" hint="HTML بسيط مسموح — يتم تنظيفه على الخادم (لا scripts ولا أحداث)"><textarea v-model="form.content_html" class="form-control tw_editor" rows="12" dir="auto" /></AdminFormField>
            </div>

            <div v-if="hasImage" class="col-12">
              <AdminFormField label="الصورة ( png,jpg,jpeg,webp ) && أقصى حجم 2 ميجا">
                <img v-if="currentImage && !image" :src="publicUrl(currentImage)" alt="الصورة الحالية" style="height: 70px" class="mb-2 d-block">
                <AdminFileDrop accept="image/png,image/jpeg,image/webp" :height="50" :max-bytes="2097152" @file="image = $event" />
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
