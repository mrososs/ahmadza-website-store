<script setup lang="ts">
// resources/views/admin/request-book/show.blade.php — review a submission. Approval creates ONE draft book
// (publishing stays a separate admin action). Documents open through short-lived signed URLs (admin / owner only).
import { CONTRIBUTOR_DEAL_LABEL } from '~~/shared/constants'

definePageMeta({ layout: 'admin', middleware: ['admin'] })
const heading = ref('بيانات الطلب')
useAdminTitle(heading)

const route = useRoute()
const id = String(route.params.id)
interface Detail {
  id: string; title: string; maker_name: string | null; about: string | null; deal: 'share' | 'rent'; cost: number | null; currency: string
  whatsapp: string | null; iban: string | null; status: 'pending' | 'approved' | 'declined'; review_note: string | null; created_at: string; book_id: number | null
  owner: { id: string; name: string; email: string | null }
  documents: { book: boolean; cover: boolean; iban: boolean; ministry: boolean }
}
const d = ref<Detail | null>(null)
const error = ref('')
const info = ref('')
const note = ref('')
const busy = ref(false)
const BADGE = { pending: 'bg-warning', approved: 'bg-success', declined: 'bg-danger' } as const
const LABEL = { pending: 'مراجعة', approved: 'موافقة', declined: 'رفض' } as const

async function load() {
  try {
    d.value = await $fetch<Detail>(`/api/admin/request-books/${id}`)
    heading.value = `بيانات الطلب - #${d.value.title}`
  } catch (e) { error.value = partnerErrorMessage(e) }
}
onMounted(load)

async function decide(approve: boolean) {
  busy.value = true; error.value = ''; info.value = ''
  try {
    const r = await $fetch<{ bookId?: number; warnings?: string[] }>(`/api/admin/request-books/${id}/decision`, { method: 'POST', body: { approve, note: note.value || null } })
    info.value = approve ? `تمت الموافقة وإنشاء مسودة كتاب رقم ${r.bookId}${r.warnings?.length ? ' — ' + r.warnings.join('، ') : ''}` : 'تم رفض الطلب'
    await load()
  } catch (e) { error.value = partnerErrorMessage(e) } finally { busy.value = false }
}
const doc = (k: string) => `/api/contributor/requests/${id}/document/${k}`
</script>

<template>
  <div>
    <div v-if="error" class="alert alert-danger" role="alert">{{ error }}</div>
    <div v-if="info" class="alert alert-success" role="status">{{ info }}</div>
    <div v-if="!d && !error" class="text-center p-5" role="status"><i class="fa fa-spinner fa-spin" /> جاري التحميل…</div>
    <div v-if="d" class="row">
      <div class="col-12">
        <div class="main-body">
          <div class="row gutters-sm">
            <div class="col-md-4 mb-3">
              <div class="card">
                <div class="card-body">
                  <div class="d-flex flex-column align-items-center text-center">
                    <img v-if="d.documents.cover" :src="doc('cover')" :alt="d.title" :title="d.title" class="img-fluid cover">
                    <img v-else src="/assets/images/default-cover.webp" :alt="d.title" class="img-fluid cover">
                    <div class="mt-3">
                      <h4>{{ d.title }}</h4>
                      <span class="btn" :class="BADGE[d.status]" style="color: #fff">{{ LABEL[d.status] }}</span>
                      <NuxtLink v-if="d.book_id" class="btn btn-primary btn-block mt-2" :to="`/admin/books/${d.book_id}`" target="_blank">عرض الكتاب (مسودة) <i class="fa fa-external-link" /></NuxtLink>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div class="col-md-8">
              <div class="card mb-3">
                <div class="card-body">
                  <div class="row"><div class="col-sm-3"><h6 class="mb-0">أسم الكتاب</h6></div><div class="col-sm-9 text-secondary">{{ d.title }}</div></div><hr>
                  <div class="row"><div class="col-sm-3"><h6 class="mb-0">مالك الكتاب</h6></div><div class="col-sm-9 text-secondary">{{ d.owner.name }} <small dir="ltr">({{ d.owner.email }})</small></div></div><hr>
                  <div class="row"><div class="col-sm-3"><h6 class="mb-0">نوع الاتفاقية</h6></div><div class="col-sm-9 text-secondary">{{ CONTRIBUTOR_DEAL_LABEL[d.deal] }}</div></div><hr>
                  <div class="row"><div class="col-sm-3"><h6 class="mb-0">الواتساب</h6></div><div class="col-sm-9 text-secondary" dir="ltr">{{ d.whatsapp }}</div></div><hr>
                  <div class="row"><div class="col-sm-3"><h6 class="mb-0">IBAN</h6></div><div class="col-sm-9 text-secondary" dir="ltr">{{ d.iban }}</div></div><hr>
                  <div class="row"><div class="col-sm-3"><h6 class="mb-0">نوع الكتاب</h6></div><div class="col-sm-9 text-secondary">{{ d.cost ? 'مدفوع' : 'مجانى' }}</div></div><hr>
                  <div class="row"><div class="col-sm-3"><h6 class="mb-0">تكلفة الكتاب</h6></div><div class="col-sm-9 text-secondary">{{ (d.cost ?? 0).toFixed(2) }}</div></div><hr>
                  <div class="row"><div class="col-sm-3"><h6 class="mb-0">العملة</h6></div><div class="col-sm-9 text-secondary">{{ d.currency }}</div></div><hr>
                  <div class="row"><div class="col-sm-3"><h6 class="mb-0">تاريخ تسجيل الطلب</h6></div><div class="col-sm-9 text-secondary">{{ partnerDateTime(d.created_at) }}</div></div>
                  <template v-if="d.review_note"><hr><div class="row"><div class="col-sm-3"><h6 class="mb-0">ملاحظة المراجعة</h6></div><div class="col-sm-9 text-secondary">{{ d.review_note }}</div></div></template>
                </div>
              </div>
              <div v-if="d.status === 'pending'" class="card mb-3">
                <div class="card-body">
                  <div class="form-group"><label for="rv-note">ملاحظة (اختياري)</label><textarea id="rv-note" v-model="note" class="form-control" /></div>
                  <button type="button" class="btn btn-success" :disabled="busy" @click="decide(true)"><i class="fa fa-check" /> موافقة وإنشاء مسودة</button>
                  <button type="button" class="btn btn-danger" :disabled="busy" @click="decide(false)"><i class="fa fa-times" /> رفض</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="col-12">
        <div id="profile-accordion" class="accordion">
          <div class="card">
            <div class="card-header"><button class="button btn-block" type="button" data-toggle="collapse" data-target="#attachment" aria-expanded="true">المرفقات</button></div>
            <div id="attachment" class="collapse show" data-parent="#profile-accordion">
              <div class="card-body">
                <div v-for="a in [{ k: 'book', l: 'الكتاب' }, { k: 'iban', l: 'IBAN' }, { k: 'ministry', l: 'فسح وزارة الاعلام' }, { k: 'cover', l: 'صورة الغلاف' }]" :key="a.k">
                  <div class="row"><div class="col-sm-3"><h6 class="mb-0">{{ a.l }}</h6></div>
                    <div class="col-sm-9 text-center"><a v-if="d.documents[a.k as keyof typeof d.documents]" :href="doc(a.k)" target="_blank" rel="noopener">أضغط هنا</a><span v-else>لا يوجد</span></div>
                  </div><hr>
                </div>
              </div>
            </div>
          </div>
          <div class="card">
            <div class="card-header"><button class="button btn-block" type="button" data-toggle="collapse" data-target="#maker_info" aria-expanded="false">عن المؤلف</button></div>
            <div id="maker_info" class="collapse" data-parent="#profile-accordion"><div class="card-body" style="white-space: pre-wrap">{{ d.maker_name }}</div></div>
          </div>
          <div class="card">
            <div class="card-header"><button class="button btn-block" type="button" data-toggle="collapse" data-target="#about_book" aria-expanded="false">عن الكتاب</button></div>
            <div id="about_book" class="collapse" data-parent="#profile-accordion"><div class="card-body" style="white-space: pre-wrap">{{ d.about }}</div></div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
