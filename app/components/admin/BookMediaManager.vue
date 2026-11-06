<script setup lang="ts">
// Port of the media section of admin/book/content.blade.php. Files go to the PRIVATE bucket through the server
// (magic-byte validated, hashed); external entries must be https. Visibility replaces the legacy is_free 0/1/2.
const props = defineProps<{ bookId: number }>()
const emit = defineEmits<{ changed: [] }>()

interface Media { id: number; kind: 'file' | 'audio'; visibility: 'preview' | 'after_purchase'; name: string; page_count: number; sort_order: number; is_external: boolean; external_url: string | null; byte_size: number | null; extension: string | null }
const { data, pending, error, refresh } = await useFetch<{ items: Media[] }>(`/api/admin/books/${props.bookId}/media`, { server: false, key: `admin-media-${props.bookId}` })
const rows = ref<Media[]>([])
watch(() => data.value, (d) => { rows.value = (d?.items ?? []).map((m) => ({ ...m })) }, { immediate: true })

const tab = ref<'file' | 'audio'>('file')
const shown = computed(() => rows.value.filter((m) => m.kind === tab.value))
const msg = reactive({ ok: '', err: '' })
const visOptions = [{ value: 'preview', label: 'قبل الشراء (معاينة)' }, { value: 'after_purchase', label: 'بعد الشراء' }]

function say(ok: string, err = '') { msg.ok = ok; msg.err = err }

async function save(m: Media) {
  try {
    await adminFetch(`/api/admin/books/${props.bookId}/media/${m.id}`, { method: 'PUT', body: { name: m.name, visibility: m.visibility, sort_order: Number(m.sort_order) || 0 } })
    say('تم الحفظ')
  } catch (e) { say('', (e as Error).message) }
}
const toDelete = ref<Media | null>(null)
async function remove() {
  if (!toDelete.value) return
  try {
    await adminFetch(`/api/admin/books/${props.bookId}/media/${toDelete.value.id}`, { method: 'DELETE' })
    toDelete.value = null
    say('تم الحذف')
    await refresh(); emit('changed')
  } catch (e) { say('', (e as Error).message); toDelete.value = null }
}

// upload (multipart)
const up = reactive({ file: null as File | null, name: '', visibility: 'after_purchase', sort_order: 0, busy: false })
async function upload() {
  if (!up.file) { say('', 'اختر ملفاً أولاً'); return }
  up.busy = true
  try {
    const fd = new FormData()
    fd.set('file', up.file); fd.set('name', up.name); fd.set('visibility', up.visibility); fd.set('sort_order', String(up.sort_order || 0))
    await adminFetch(`/api/admin/books/${props.bookId}/media`, { method: 'POST', body: fd })
    Object.assign(up, { file: null, name: '' })
    say('تم رفع الملف'); await refresh(); emit('changed')
  } catch (e) { say('', (e as Error).message) } finally { up.busy = false }
}
// external link (JSON)
const ext = reactive({ url: '', name: '', visibility: 'after_purchase', busy: false })
async function addExternal() {
  ext.busy = true
  try {
    await adminFetch(`/api/admin/books/${props.bookId}/media`, { method: 'POST', body: { external_url: ext.url, name: ext.name, kind: tab.value, visibility: ext.visibility, sort_order: 0 } })
    Object.assign(ext, { url: '', name: '' })
    say('تمت إضافة الرابط'); await refresh(); emit('changed')
  } catch (e) { say('', (e as Error).message) } finally { ext.busy = false }
}
const size = (n: number | null) => (n ? (n / 1048576 >= 1 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`) : '-')
</script>

<template>
  <section class="product_media_show">
    <div class="row">
      <div class="col-12">
        <div v-if="msg.ok" class="alert alert-success" role="status">{{ msg.ok }}</div>
        <div v-if="msg.err" class="alert alert-danger" role="alert">{{ msg.err }}</div>
        <div v-if="error" class="alert alert-danger" role="alert">{{ adminErrorMessage(error) }} <a href="#" @click.prevent="refresh()">إعادة المحاولة</a></div>
      </div>
      <div class="col-12">
        <ul class="nav nav-tabs" role="tablist">
          <li class="nav-item" role="presentation"><button type="button" class="nav-link" :class="{ active: tab === 'audio' }" role="tab" :aria-selected="tab === 'audio'" @click="tab = 'audio'">ملف صوتى</button></li>
          <li class="nav-item" role="presentation"><button type="button" class="nav-link" :class="{ active: tab === 'file' }" role="tab" :aria-selected="tab === 'file'" @click="tab = 'file'">ملف إلكترونى</button></li>
        </ul>
        <div class="tab-content">
          <div class="table-responsive">
            <table class="table table-bordered">
              <thead><tr><th>#</th><th>أسم الملف</th><th>الترتيب</th><th>العرض</th><th>الصفحات</th><th>الحجم</th><th>العمليات</th></tr></thead>
              <tbody>
                <tr v-if="pending && !data"><td colspan="7" class="text-center" role="status"><i class="fa fa-spinner fa-spin" /> جاري التحميل…</td></tr>
                <tr v-else-if="!shown.length"><td colspan="7" class="text-center">لا توجد ملفات</td></tr>
                <tr v-for="(m, i) in shown" :key="m.id">
                  <td>{{ i + 1 }}</td>
                  <td><input v-model="m.name" class="form-control" placeholder="أسم الملف" :aria-label="`اسم الملف ${i + 1}`"></td>
                  <td><input v-model.number="m.sort_order" type="number" min="0" class="form-control" placeholder="ترتيب الملف" :aria-label="`ترتيب الملف ${i + 1}`"></td>
                  <td><AdminSelect v-model="m.visibility as never" title="نوع العرض" :options="visOptions" /></td>
                  <td>{{ m.page_count || '-' }}</td>
                  <td>{{ m.is_external ? 'خارجي' : size(m.byte_size) }}</td>
                  <td>
                    <button class="btn btn-sm- btn-success" title="حفظ" type="button" @click="save(m)"><i class="fa fa-edit" /></button>
                    <a v-if="m.is_external && m.external_url" target="_blank" rel="noopener noreferrer" :href="m.external_url" class="btn btn-sm- btn-primary" title="فتح الرابط"><i class="fa fa-external-link" /></a>
                    <button class="btn btn-sm- btn-danger" title="حذف" type="button" @click="toDelete = m"><i class="fa fa-trash" /></button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="block-file">
            <h6>رفع {{ tab === 'file' ? 'ملف PDF' : 'ملف صوتى' }}</h6>
            <form @submit.prevent="upload">
              <div class="row">
                <div class="col-md-4"><AdminFileDrop :accept="tab === 'file' ? 'application/pdf' : 'audio/*'" :height="50" :max-bytes="104857600" @file="up.file = $event" /></div>
                <div class="col-md-3"><input v-model="up.name" class="form-control" placeholder="أسم الملف" aria-label="اسم الملف"></div>
                <div class="col-md-3"><AdminSelect v-model="up.visibility as never" title="نوع العرض" :options="visOptions" /></div>
                <div class="col-md-2"><button class="btn btn-success btn-block" :disabled="up.busy" type="submit"><i class="fa" :class="up.busy ? 'fa-spinner fa-spin' : 'fa-upload'" /> رفع</button></div>
              </div>
            </form>
            <small class="text-muted">يُفحص محتوى الملف (وليس الامتداد) ويُخزَّن في مساحة خاصة؛ الحد الأقصى 100 ميجا.</small>
          </div>
          <div class="block-file">
            <h6>إضافة رابط خارجي (https فقط)</h6>
            <form @submit.prevent="addExternal">
              <div class="row">
                <div class="col-md-4"><input v-model="ext.url" type="url" class="form-control" placeholder="https://..." aria-label="الرابط"></div>
                <div class="col-md-3"><input v-model="ext.name" class="form-control" placeholder="أسم الملف" aria-label="اسم الرابط"></div>
                <div class="col-md-3"><AdminSelect v-model="ext.visibility as never" title="نوع العرض" :options="visOptions" /></div>
                <div class="col-md-2"><button class="btn btn-primary btn-block" :disabled="ext.busy" type="submit"><i class="fa fa-plus" /> إضافة</button></div>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
    <AdminModal :open="!!toDelete" title="حذف الملف" danger @close="toDelete = null">
      <div class="form-group"><label>الملف</label><input readonly class="form-control" :value="toDelete?.name"></div>
      <template #footer><button class="btn ripple btn-danger" type="button" @click="remove">حذف</button></template>
    </AdminModal>
  </section>
</template>
