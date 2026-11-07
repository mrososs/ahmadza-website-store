<script setup lang="ts">
// Reconciliation dashboard for the incremental recovery: what was imported, what blocks publication, which files are missing.
// Verification and promotion are separate, explicit, audited steps; neither ever enables paid checkout.
import { RECOVERY_VERIFY_PHRASE, readinessReasonLabel } from '~~/shared/constants/recovery'

definePageMeta({ layout: 'admin', middleware: ['admin'] })
useAdminTitle('استعادة الكتالوج')

interface Summary {
  books: { recovered: number; by_status: Record<string, number>; verified: number; unverified: number; eligible: number; blocked: number; without_validated_media: number }
  blockers: { reason: string; label: string; count: number }[]
  media: { total: number; validated: number; by_status: Record<string, number> }
  rejects: { total: number; by_entity: Record<string, number>; by_reason: Record<string, number> }
  runs: { id: number; kind: string; started_at: string; finished_at: string | null; books: number; verified: number; eligible: number; failed: boolean }[]
}
interface Rejects { items: { id: number; run_id: number | null; entity: string; legacy_id: string | null; reason: string }[]; total: number; page: number; pageSize: number }

const { data, pending, error, refresh } = useFetch<Summary>('/api/admin/recovery/summary', { server: false })
const errorText = computed(() => (error.value ? adminErrorMessage(error.value) : ''))
const showRejects = ref(false)

// Review queue: recovered books that still need something before they can be published, one by one.
interface QueueItem { id: number; title: string; provenance: string; workflow: string | null; reasons: string[]; verified: boolean; has_cover: boolean; file_validated: boolean; original_name: string | null; pdf_author: string | null; pages: number | null; scan: string | null }
interface Queue { items: QueueItem[]; total: number; page: number; pageSize: number }
const queue = ref<Queue | null>(null)
const queueError = ref('')
async function loadQueue(page = 1) {
  queueError.value = ''
  try { queue.value = await adminFetch<Queue>('/api/admin/recovery/queue', { query: { page } }) } catch (e) { queueError.value = (e as Error).message }
}
onMounted(() => { void loadQueue() })
const rejects = ref<Rejects | null>(null)
const rejectsPage = ref(1)
async function loadRejects(page = 1) {
  rejectsPage.value = page
  try { rejects.value = await adminFetch<Rejects>('/api/admin/recovery/rejects', { query: { page } }) } catch (e) { notice.value = { ok: false, text: (e as Error).message } }
}
watch(showRejects, (v) => { if (v && !rejects.value) loadRejects() })

const STATUS_LABEL: Record<string, string> = { draft: 'مسودة', published: 'منشور', coming_soon: 'قريباً', archived: 'مؤرشف' }
const MEDIA_LABEL: Record<string, string> = { pending: 'بانتظار النقل', staged: 'بانتظار الفحص', available: 'متاح', missing: 'مفقود', rejected: 'مرفوض' }

type Action = { kind: 'verify'; run: number } | { kind: 'promote'; run: number | undefined }
const action = ref<Action | null>(null)
const phrase = ref('')
const busy = ref(false)
const notice = ref<{ ok: boolean; text: string } | null>(null)
function ask(a: Action) { action.value = a; phrase.value = ''; notice.value = null }
async function run() {
  const a = action.value
  if (!a) return
  busy.value = true
  try {
    if (a.kind === 'verify') {
      const r = await adminFetch<{ verified: number }>('/api/admin/recovery/verify', { method: 'POST', body: { run: a.run, confirm: phrase.value } })
      notice.value = { ok: true, text: `تم اعتماد ${r.verified} كتاب. لم يُنشر أي كتاب بهذه الخطوة.` }
    } else {
      const r = await adminFetch<{ promoted: number }>('/api/admin/recovery/promote', { method: 'POST', body: { run: a.run } })
      notice.value = { ok: true, text: `تم تفعيل ${r.promoted} كتاب مؤهل فقط. الدفع المباشر لم يتغير.` }
    }
    action.value = null
    await refresh()
  } catch (e) { notice.value = { ok: false, text: (e as Error).message } } finally { busy.value = false }
}
const fmt = (n: number) => n.toLocaleString('en-US')
</script>

<template>
  <div class="row recovery-page">
    <div class="col-12">
      <div v-if="notice" class="alert" :class="notice.ok ? 'alert-success' : 'alert-danger'" role="status">{{ notice.text }}</div>
      <div v-if="errorText" class="alert alert-danger" role="alert">{{ errorText }} <button class="btn btn-sm btn-light" type="button" @click="refresh()">إعادة المحاولة</button></div>
      <div v-else-if="pending && !data" class="text-center p-5" role="status"><i class="fa fa-spinner fa-spin" /> جاري التحميل…</div>
    </div>

    <template v-if="data">
      <div class="col-12" v-if="!data.books.recovered && !data.runs.length">
        <div class="alert alert-info" role="status">لا توجد بيانات مستعادة بعد. عند اكتمال الاستيراد في بيئة الاستعادة ستظهر هنا الأعداد وأسباب الإيقاف.</div>
      </div>

      <AdminStatCard color="primary" icon="fa-book" label="كتب مستعادة" to="/admin/books?recovery=recovered" :total="fmt(data.books.recovered)" />
      <AdminStatCard color="success" icon="fa-check-circle" label="جاهزة للنشر" to="/admin/books?recovery=ready" :total="fmt(data.books.eligible)" />
      <AdminStatCard color="warning" icon="fa-exclamation-triangle" label="غير جاهزة" to="/admin/books?recovery=not_ready" :total="fmt(data.books.blocked)" />
      <AdminStatCard color="danger" icon="fa-file-o" label="بلا ملف موثق" to="/admin/books?recovery=missing_media" :total="fmt(data.books.without_validated_media)" />

      <div class="col-12 mb-30" id="review-queue">
        <div class="card"><div class="card-body">
          <h5 class="card-title">طابور المراجعة <span v-if="queue" class="badge badge-warning">{{ fmt(queue.total) }}</span></h5>
          <p class="text-muted">الكتب المستعادة تحتاج إلى استكمال قبل النشر. افتح كل كتاب، أدخل السعر الصحيح وراجع البيانات واعتمده ثم انشره. لا شيء يُنشر تلقائياً، والأسماء المأخوذة من الملف غير موثقة ولا تُربط بأي مؤلف.</p>
          <div v-if="queueError" class="alert alert-danger" role="alert">{{ queueError }}</div>
          <p v-else-if="queue && !queue.items.length" class="mb-0">لا توجد كتب بانتظار المراجعة.</p>
          <div v-else-if="queue" class="table-responsive">
            <table class="table table-sm mb-2">
              <thead><tr><th>الكتاب</th><th>الملف الأصلي</th><th>ما ينقص</th><th /></tr></thead>
              <tbody>
                <tr v-for="q in queue.items" :key="q.id">
                  <td>
                    <NuxtLink :to="`/admin/books/${q.id}`">{{ q.title }}</NuxtLink>
                    <small class="d-block text-muted">
                      <span v-if="q.pages">{{ q.pages }} صفحة · </span>
                      <span v-if="q.pdf_author">المؤلف في الملف (غير موثق): {{ q.pdf_author }}</span>
                    </small>
                  </td>
                  <td dir="ltr" class="text-right"><code>{{ q.original_name ?? '—' }}</code><small v-if="q.scan" class="d-block text-muted">scan: {{ q.scan }}</small></td>
                  <td><span v-for="r in q.reasons" :key="r" class="badge badge-warning ml-1 d-inline-block mb-1">{{ readinessReasonLabel(r) }}</span></td>
                  <td class="text-left"><NuxtLink class="btn btn-sm btn-primary" :to="`/admin/books/${q.id}`">مراجعة</NuxtLink></td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-if="queue && queue.total > queue.pageSize">
            <button class="btn btn-sm btn-light" type="button" :disabled="queue.page <= 1" @click="loadQueue(queue.page - 1)">السابق</button>
            <span class="mx-2">{{ queue.page }} / {{ Math.ceil(queue.total / queue.pageSize) }}</span>
            <button class="btn btn-sm btn-light" type="button" :disabled="queue.page * queue.pageSize >= queue.total" @click="loadQueue(queue.page + 1)">التالي</button>
          </div>
        </div></div>
      </div>

      <div class="col-lg-6 mb-30">
        <div class="card h-100"><div class="card-body">
          <h5 class="card-title">لماذا لم تُنشر الكتب؟</h5>
          <p v-if="!data.blockers.length" class="text-muted mb-0">لا توجد أسباب إيقاف.</p>
          <div v-else class="table-responsive">
            <table class="table table-sm mb-0">
              <thead><tr><th>السبب</th><th class="text-left">العدد</th></tr></thead>
              <tbody><tr v-for="b in data.blockers" :key="b.reason"><td>{{ readinessReasonLabel(b.reason) }}</td><td class="text-left">{{ fmt(b.count) }}</td></tr></tbody>
            </table>
          </div>
        </div></div>
      </div>

      <div class="col-lg-6 mb-30">
        <div class="card h-100"><div class="card-body">
          <h5 class="card-title">الحالة والملفات</h5>
          <ul class="list-unstyled mb-3">
            <li v-for="(n, s) in data.books.by_status" :key="s">{{ STATUS_LABEL[s] ?? s }}: <strong>{{ fmt(n) }}</strong></li>
            <li>تم اعتماد المصدر: <strong>{{ fmt(data.books.verified) }}</strong> — لم يُعتمد: <strong>{{ fmt(data.books.unverified) }}</strong></li>
          </ul>
          <h6>ملفات الكتب</h6>
          <ul class="list-unstyled mb-0">
            <li>الإجمالي: <strong>{{ fmt(data.media.total) }}</strong> — موثّق: <strong>{{ fmt(data.media.validated) }}</strong></li>
            <li v-for="(n, s) in data.media.by_status" :key="s">{{ MEDIA_LABEL[s] ?? s }}: {{ fmt(n) }}</li>
          </ul>
        </div></div>
      </div>

      <div class="col-12 mb-30">
        <div class="card"><div class="card-body">
          <h5 class="card-title">عمليات الاستيراد</h5>
          <p v-if="!data.runs.length" class="text-muted mb-0">لا توجد عمليات استيراد.</p>
          <div v-else class="table-responsive">
            <table class="table table-sm mb-0">
              <thead><tr><th>#</th><th>التاريخ</th><th>الكتب</th><th>معتمدة</th><th>جاهزة</th><th /></tr></thead>
              <tbody>
                <tr v-for="r in data.runs" :key="r.id">
                  <td>{{ r.id }}<span v-if="r.failed" class="badge badge-danger ml-1">فشلت</span></td>
                  <td>{{ fmtDateTime(r.started_at) }}</td>
                  <td>{{ fmt(r.books) }}</td><td>{{ fmt(r.verified) }}</td><td>{{ fmt(r.eligible) }}</td>
                  <td class="text-left">
                    <button class="btn btn-sm btn-primary" type="button" :disabled="!r.books || r.verified === r.books" @click="ask({ kind: 'verify', run: r.id })">اعتماد المصدر</button>
                    <button class="btn btn-sm btn-success" type="button" :disabled="!r.eligible" @click="ask({ kind: 'promote', run: r.id })">تفعيل المؤهل</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div></div>
      </div>

      <div class="col-12 mb-30">
        <div class="card"><div class="card-body">
          <h5 class="card-title">السجلات المرفوضة ({{ fmt(data.rejects.total) }})</h5>
          <p v-if="!data.rejects.total" class="text-muted mb-0">لا توجد سجلات مرفوضة.</p>
          <template v-else>
            <ul class="list-inline mb-2"><li v-for="(n, e) in data.rejects.by_entity" :key="e" class="list-inline-item"><span class="badge badge-secondary">{{ e }}: {{ fmt(n) }}</span></li></ul>
            <button class="btn btn-sm btn-light" type="button" :aria-expanded="showRejects" @click="showRejects = !showRejects">{{ showRejects ? 'إخفاء التفاصيل' : 'عرض التفاصيل' }}</button>
            <div v-if="showRejects && rejects" class="table-responsive mt-3">
              <table class="table table-sm mb-2">
                <thead><tr><th>الجدول</th><th>المعرّف القديم</th><th>السبب</th></tr></thead>
                <tbody><tr v-for="r in rejects.items" :key="r.id"><td>{{ r.entity }}</td><td>{{ r.legacy_id ?? '—' }}</td><td>{{ r.reason }}</td></tr></tbody>
              </table>
              <button class="btn btn-sm btn-light" type="button" :disabled="rejectsPage <= 1" @click="loadRejects(rejectsPage - 1)">السابق</button>
              <button class="btn btn-sm btn-light" type="button" :disabled="rejectsPage * rejects.pageSize >= rejects.total" @click="loadRejects(rejectsPage + 1)">التالي</button>
            </div>
          </template>
        </div></div>
      </div>
    </template>

    <AdminModal :open="!!action" :title="action?.kind === 'verify' ? 'اعتماد المصدر' : 'تفعيل الكتب المؤهلة'" @close="action = null">
      <template v-if="action?.kind === 'verify'">
        <p>اعتماد المصدر يعني أنك تؤكد أن بيانات هذه العملية أصلية من النظام القديم. <strong>لا ينشر أي كتاب.</strong></p>
        <div class="form-group">
          <label for="verify-phrase">اكتب العبارة التالية للتأكيد:</label>
          <p class="mb-1"><code>{{ RECOVERY_VERIFY_PHRASE }}</code></p>
          <input id="verify-phrase" v-model="phrase" class="form-control" autocomplete="off">
        </div>
      </template>
      <p v-else>سيتم تفعيل الكتب التي تستوفي كل شروط النشر فقط، بحالتها الأصلية. تبقى بقية الكتب مسودات. لا يتغير الدفع المباشر.</p>
      <div v-if="notice && !notice.ok" class="alert alert-danger" role="alert">{{ notice.text }}</div>
      <template #footer>
        <button class="btn ripple btn-primary" type="button" :disabled="busy || (action?.kind === 'verify' && phrase !== RECOVERY_VERIFY_PHRASE)" @click="run">
          <i v-if="busy" class="fa fa-spinner fa-spin" /> تأكيد
        </button>
      </template>
    </AdminModal>
  </div>
</template>
