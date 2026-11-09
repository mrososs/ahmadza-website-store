<script setup lang="ts">
// Port of admin/book/index.blade.php (status filter via the sidebar: ?status=active|inactive|soon|trash).
definePageMeta({ layout: 'admin', middleware: ['admin'] })
useAdminTitle('الكتب')
import { BULK_BOOKS_MAX, BULK_SKIP_LABEL, bulkPriceSchema, type BulkBookOperation, type BulkBooksResult } from '~~/shared/schemas/admin'
import { useRowSelection } from '~~/shared/utils/rowSelection'
import { RECOVERY_LIST_FILTERS, RECOVERY_LIST_FILTER_LABEL, WORKFLOW_BADGE, WORKFLOW_LABEL, WORKFLOW_STATUSES, readinessReasonLabel } from '~~/shared/constants/recovery'

interface Row { id: number; title: string; cover_path: string | null; status: string; kind: string; price_amount: number; price_currency: string; view_count: number; orders_count: number; favourites_count: number; deleted_at: string | null
  provenance: string; cover_provenance: string | null; cover_pending: string | null; readiness: { eligible: boolean; reasons: string[]; media_total: number; media_validated: number; media_missing: number; workflow_status: string | null } | null }
// cover filter: where the cover is at. gap filter: what is still missing. Both are URL state like the other filters.
const COVER_FILTERS = [['all', 'كل الأغلفة'], ['none', 'بلا غلاف'], ['generated', 'مُولَّد من الملف'], ['original', 'غلاف أصلي مُسترجع'], ['candidate', 'مقترح بانتظار القرار']] as const
const GAP_FILTERS = [['all', 'بلا فلتر'], ['price', 'السعر غير محدد'], ['author', 'بلا مؤلف'], ['pdf', 'بلا ملف PDF موثق']] as const
const { publicUrl } = useMediaUrl()
const route = useRoute()
const recovery = computed(() => { const v = String(Array.isArray(route.query.recovery) ? route.query.recovery[0] : route.query.recovery ?? 'all'); return (RECOVERY_LIST_FILTERS as readonly string[]).includes(v) ? v : 'all' })
const workflow = computed(() => { const v = String(Array.isArray(route.query.workflow) ? route.query.workflow[0] : route.query.workflow ?? 'all'); return (WORKFLOW_STATUSES as readonly string[]).includes(v) ? v : 'all' })
const pick = (name: 'cover' | 'gap', allowed: readonly (readonly [string, string])[]) => { const v = String(Array.isArray(route.query[name]) ? (route.query[name] as string[])[0] : route.query[name] ?? 'all'); return allowed.some(([k]) => k === v) ? v : 'all' }
const cover = computed(() => pick('cover', COVER_FILTERS))
const gap = computed(() => pick('gap', GAP_FILTERS))
const { data, pending, errorText, refresh, query } = useAdminList<Row>('/api/admin/books', () => ({ recovery: recovery.value === 'all' ? undefined : recovery.value, workflow: workflow.value === 'all' ? undefined : workflow.value, cover: cover.value === 'all' ? undefined : cover.value, gap: gap.value === 'all' ? undefined : gap.value }))
const setFilter = (name: 'cover' | 'gap', v: string) => navigateTo({ query: { ...route.query, page: undefined, [name]: v === 'all' ? undefined : v } })
const setWorkflow = (v: string) => navigateTo({ query: { ...route.query, page: undefined, workflow: v === 'all' ? undefined : v } })
const setRecovery = (v: string) => navigateTo({ query: { ...route.query, page: undefined, recovery: v === 'all' ? undefined : v } })
const readinessTitle = (r: NonNullable<Row['readiness']>) => r.reasons.map(readinessReasonLabel).join('، ')
const columns = [
  { key: 'id', label: '#', cls: 'wd-5p' }, { key: 'cover', label: 'الغلاف', cls: 'wd-15p' }, { key: 'title', label: 'الاسم', cls: 'wd-25p' },
  { key: 'status', label: 'الحالة', cls: 'wd-10p' }, { key: 'orders_count', label: 'الطلبات', cls: 'wd-10p' }, { key: 'view_count', label: 'الزيارات', cls: 'wd-10p' },
  { key: 'favourites_count', label: 'المفضلة', cls: 'wd-10p' }, { key: 'price', label: 'التكلفة', cls: 'wd-10p' }, { key: 'kind', label: 'النوع', cls: 'wd-10p' }, { key: 'recovery', label: 'حالة العمل', cls: 'wd-10p' }, { key: 'ops', label: 'عمليات', cls: 'wd-15p' },
]
/** A recorded cover whose file is missing from storage must not show a broken-image icon with alt text: use the default cover (as the storefront does). */
function fallbackCover(e: Event) {
  const img = e.target as HTMLImageElement
  if (!img.src.endsWith('/assets/images/default-cover.webp')) img.src = '/assets/images/default-cover.webp'
}
const trash = computed(() => query.value.status === 'trash')

const target = ref<Row | null>(null)
const mode = ref<'delete' | 'restore'>('delete')
const busy = ref(false)
const actionError = ref('')
function ask(r: Row, m: 'delete' | 'restore') { target.value = r; mode.value = m; actionError.value = '' }
async function confirm() {
  if (!target.value) return
  busy.value = true
  try {
    await adminFetch(`/api/admin/books/${target.value.id}${mode.value === 'restore' ? '/restore' : ''}`, { method: mode.value === 'restore' ? 'POST' : 'DELETE' })
    target.value = null
    await refresh()
  } catch (e) { actionError.value = (e as Error).message } finally { busy.value = false }
}

// ---- bulk actions: the selection is keyed by id so it survives paging / search / filters / refreshes, and is only ever ticked by hand ----
const sel = useRowSelection<Row>((r) => r.title)
const pageState = computed(() => sel.pageState(data.value?.items))
const offPage = computed(() => sel.count.value - (data.value?.items ?? []).filter((r) => sel.has(r.id)).length)
const overLimit = computed(() => sel.count.value > BULK_BOOKS_MAX)
const bulk = ref<BulkBookOperation | null>(null)
const bulkPrice = ref('')
const bulkBusy = ref(false)
const bulkError = ref('')
const bulkNotice = ref<{ ok: boolean; text: string; details: string[] } | null>(null)
const booksPhrase = (n: number) => (n === 1 ? 'كتاب واحد' : n === 2 ? 'كتابين' : n <= 10 ? `${n} كتب` : `${n} كتاباً`)
const BULK_TEXT: Record<BulkBookOperation, { title: string; done: string; danger?: boolean }> = {
  make_free: { title: 'تحويل إلى مجاني', done: 'حُوّل إلى مجاني' },
  make_paid: { title: 'تحويل إلى مدفوع', done: 'حُوّل إلى مدفوع' },
  soft_delete: { title: 'نقل إلى المهملات', done: 'نُقل إلى المهملات', danger: true },
}
function askBulk(op: BulkBookOperation) { if (bulkBusy.value || !sel.count.value || overLimit.value) return; bulk.value = op; bulkPrice.value = ''; bulkError.value = ''; bulkNotice.value = null }
function closeBulk() { if (!bulkBusy.value) bulk.value = null }
/** Accepts Arabic-Indic digits and the Arabic decimal separator, as an Arabic keyboard produces them. */
const parsePrice = (s: string) => Number(s.trim().replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/[٫،,]/g, '.'))
async function runBulk() {
  const op = bulk.value
  if (!op || bulkBusy.value) return // a second click / Enter while the request is in flight does nothing
  let price: number | undefined
  if (op === 'make_paid') {
    const r = bulkPriceSchema.safeParse(bulkPrice.value.trim() === '' ? undefined : parsePrice(bulkPrice.value))
    if (!r.success) { bulkError.value = r.error.issues[0]?.message ?? 'السعر غير صالح'; return }
    price = r.data
  }
  bulkBusy.value = true
  bulkError.value = ''
  try {
    const res = await adminFetch<BulkBooksResult>('/api/admin/books/bulk', { method: 'POST', body: { operation: op, ids: sel.ids.value, ...(price === undefined ? {} : { price }) } })
    // done / already in the target state / gone leave the selection; books the server refused stay selected so they can be reviewed
    sel.remove([...res.updated, ...res.skipped.filter((s) => ['unchanged', 'not_found', 'already_deleted'].includes(s.reason)).map((s) => s.id)])
    const titleOf = (id: number) => data.value?.items.find((r) => r.id === id)?.title ?? `#${id}`
    bulk.value = null
    bulkNotice.value = {
      ok: res.updated.length > 0,
      text: res.updated.length ? `${BULK_TEXT[op].done}: ${booksPhrase(res.updated.length)}${res.skipped.length ? `، وتخطّي ${booksPhrase(res.skipped.length)}` : ''}.` : 'لم يتغير أي كتاب.',
      details: res.skipped.map((s) => `${titleOf(s.id)}: ${BULK_SKIP_LABEL[s.reason]}`),
    }
    await refresh()
  } catch (e) { bulkError.value = (e as Error).message } finally { bulkBusy.value = false }
}
async function clone(r: Row) {
  try { const c = await adminFetch<{ id: number }>(`/api/admin/books/${r.id}/clone`, { method: 'POST' }); await navigateTo(`/admin/books/${c.id}`) } catch (e) { actionError.value = (e as Error).message }
}
</script>

<template>
  <div class="row">
    <div class="col-12 text-right mb-3">
      <NuxtLink class="button" to="/admin/books/create"><i class="fa fa-plus" /> أضافة جديد</NuxtLink>
    </div>
    <div class="col-12 mb-3 recovery-filter">
      <label for="workflow-filter" class="mr-2">حالة العمل</label>
      <select id="workflow-filter" class="form-control d-inline-block w-auto ml-3 mb-2" style="height: auto; padding: 8px 12px; width: auto; min-width: 180px" :value="workflow" @change="setWorkflow(($event.target as HTMLSelectElement).value)">
        <option v-for="w in WORKFLOW_STATUSES" :key="w" :value="w">{{ WORKFLOW_LABEL[w] }}</option>
      </select>
      <label for="recovery-filter" class="mr-2">الاستعادة</label>
      <select id="recovery-filter" class="form-control d-inline-block w-auto mb-2" style="height: auto; padding: 8px 12px; width: auto; min-width: 180px" :value="recovery" @change="setRecovery(($event.target as HTMLSelectElement).value)">
        <option v-for="f in RECOVERY_LIST_FILTERS" :key="f" :value="f">{{ RECOVERY_LIST_FILTER_LABEL[f] }}</option>
      </select>
      <label for="cover-filter" class="mr-3 ml-2">الغلاف</label>
      <select id="cover-filter" class="form-control d-inline-block w-auto mb-2" style="height: auto; padding: 8px 12px; width: auto; min-width: 180px" :value="cover" @change="setFilter('cover', ($event.target as HTMLSelectElement).value)">
        <option v-for="[k, label] in COVER_FILTERS" :key="k" :value="k">{{ label }}</option>
      </select>
      <label for="gap-filter" class="mr-3 ml-2">النواقص</label>
      <select id="gap-filter" class="form-control d-inline-block w-auto mb-2" style="height: auto; padding: 8px 12px; width: auto; min-width: 180px" :value="gap" @change="setFilter('gap', ($event.target as HTMLSelectElement).value)">
        <option v-for="[k, label] in GAP_FILTERS" :key="k" :value="k">{{ label }}</option>
      </select>
    </div>
    <div v-if="actionError && !target" class="col-12"><div class="alert alert-danger" role="alert">{{ actionError }}</div></div>
    <div v-if="bulkNotice" class="col-12">
      <div class="alert alert-dismissible" :class="bulkNotice.ok ? 'alert-success' : 'alert-warning'" :role="bulkNotice.ok ? 'status' : 'alert'">
        <button type="button" class="close" aria-label="إغلاق" @click="bulkNotice = null"><span aria-hidden="true">&times;</span></button>
        {{ bulkNotice.text }}
        <ul v-if="bulkNotice.details.length" class="mb-0 mt-2"><li v-for="d in bulkNotice.details" :key="d">{{ d }}</li></ul>
      </div>
    </div>
    <div v-if="sel.count.value && !trash" class="col-12 mb-3 bulk-toolbar-wrap">
      <div class="bulk-toolbar" role="toolbar" aria-label="إجراءات جماعية على الكتب المحددة">
        <span class="bulk-count" role="status" aria-live="polite">
          <strong>{{ sel.count.value }}</strong> {{ sel.count.value === 1 ? 'كتاب محدد' : 'كتب محددة' }}
          <small v-if="offPage > 0" class="d-block text-muted">منها {{ offPage }} خارج النتائج المعروضة الآن</small>
        </span>
        <div class="bulk-actions">
          <button type="button" class="btn btn-sm btn-success" :disabled="bulkBusy || overLimit" @click="askBulk('make_free')"><i class="fa fa-gift" /> تحويل إلى مجاني</button>
          <button type="button" class="btn btn-sm btn-primary" :disabled="bulkBusy || overLimit" @click="askBulk('make_paid')"><i class="fa fa-dollar" /> تحويل إلى مدفوع</button>
          <button type="button" class="btn btn-sm btn-danger" :disabled="bulkBusy || overLimit" @click="askBulk('soft_delete')"><i class="fa fa-trash" /> نقل إلى المهملات</button>
          <button type="button" class="btn btn-sm btn-secondary" :disabled="bulkBusy" @click="sel.clear()"><i class="fa fa-times" /> إلغاء التحديد</button>
        </div>
        <div v-if="overLimit" class="text-danger w-100" role="alert">الحد الأقصى {{ BULK_BOOKS_MAX }} كتاباً في العملية الواحدة: ألغِ تحديد {{ sel.count.value - BULK_BOOKS_MAX }} على الأقل.</div>
      </div>
    </div>
    <div class="col-12 mb-30">
      <AdminDataTable
        :columns="columns" :rows="data?.items" :loading="pending" :error="errorText" :total="data?.total" :page="data?.page" :page-size="data?.pageSize" searchable search-placeholder="ابحث بعنوان الكتاب"
        :selectable="!trash" :is-selected="(r: Row) => sel.has(r.id)" :page-state="pageState" :select-label="(r: Row) => `تحديد ${r.title}`"
        @select="(r: Row, on: boolean) => sel.set(r, on)" @select-page="(on: boolean) => sel.setPage(data?.items ?? [], on)" @retry="refresh()">
        <template #cell-cover="{ row }"><img class="img-fluid" style="width: 35px" :src="publicUrl(row.cover_path)" :alt="row.title" :title="row.title" @error="fallbackCover"></template>
        <template #cell-status="{ row }"><span class="badge" :class="STATUS_BADGE[row.status]?.cls">{{ STATUS_BADGE[row.status]?.label }}</span></template>
        <template #cell-price="{ row }">{{ Number(row.price_amount).toFixed(2) }} <template v-if="row.kind === 'paid'">دولار</template></template>
        <template #cell-kind="{ row }">{{ row.kind === 'free' ? 'مجانى' : 'مدفوع' }}</template>
        <template #cell-recovery="{ row }">
          <span v-if="row.readiness?.workflow_status" class="badge d-block mb-1" :class="WORKFLOW_BADGE[row.readiness.workflow_status]" :title="readinessTitle(row.readiness)">{{ WORKFLOW_LABEL[row.readiness.workflow_status as keyof typeof WORKFLOW_LABEL] ?? row.readiness.workflow_status }}</span>
          <template v-if="(row.provenance === 'legacy' || row.provenance === 'recovered_media') && row.readiness">
            <span class="badge" :class="row.readiness.eligible ? 'badge-success' : 'badge-warning'" :title="readinessTitle(row.readiness)">{{ row.readiness.eligible ? 'جاهز' : `ناقص (${row.readiness.reasons.length})` }}</span>
            <span v-if="row.readiness.media_validated === 0" class="badge badge-danger d-block mt-1">بلا ملف موثق</span>
          </template>
          <span v-if="row.cover_provenance === 'generated_from_pdf'" class="badge badge-info d-block mt-1" title="صورة الصفحة الأولى من ملف الكتاب، وليست الغلاف الأصلي">غلاف مُولَّد من الملف</span>
          <span v-else-if="row.cover_provenance === 'original_cover'" class="badge badge-success d-block mt-1">غلاف أصلي</span>
          <span v-if="row.cover_pending === 'true'" class="badge badge-warning d-block mt-1">غلاف مقترح بانتظار القرار</span>
        </template>
        <template #cell-ops="{ row }">
          <div>
            <button aria-expanded="false" aria-haspopup="true" class="btn ripple btn-sm btn-primary" data-toggle="dropdown" type="button">عمليات <i class="fa fa-caret-down ml-1" /></button>
            <div class="dropdown-menu tx-13">
              <NuxtLink class="dropdown-item btn btn-info" target="_blank" :to="`/book/${row.id}`"><i class="fa fa-eye" /> مشاهدة</NuxtLink>
              <template v-if="!trash">
                <NuxtLink class="dropdown-item btn btn-success" :to="`/admin/books/${row.id}`"><i class="fa fa-edit" /> تعديل</NuxtLink>
                <NuxtLink class="dropdown-item btn btn-default" :to="`/admin/books/${row.id}/media`"><i class="fa fa-image" /> المحتويات</NuxtLink>
                <NuxtLink class="dropdown-item btn btn-default" :to="{ path: '/admin/comments', query: { book: String(row.id) } }"><i class="fa fa-comment" /> التعليقات</NuxtLink>
                <a class="dropdown-item btn btn-default" href="#" @click.prevent="clone(row)"><i class="fa fa-copy" /> نسخ</a>
                <a class="dropdown-item btn btn-danger" href="#" @click.prevent="ask(row, 'delete')"><i class="fa fa-trash" /> حذف</a>
              </template>
              <a v-else class="dropdown-item btn btn-success" href="#" @click.prevent="ask(row, 'restore')"><i class="fa fa-undo" /> استرجاع</a>
            </div>
          </div>
        </template>
      </AdminDataTable>
    </div>

    <AdminModal :open="!!bulk" :title="bulk ? BULK_TEXT[bulk].title : ''" :danger="!!bulk && !!BULK_TEXT[bulk].danger" @close="closeBulk">
      <template v-if="bulk">
        <p v-if="bulk === 'make_free'">سيتم تحويل <strong>{{ booksPhrase(sel.count.value) }}</strong> إلى مجانية (السعر 0). تبقى حالة النشر كما هي ولا يتغير شيء آخر.</p>
        <template v-else-if="bulk === 'make_paid'">
          <p>سيتم تحويل <strong>{{ booksPhrase(sel.count.value) }}</strong> إلى مدفوعة بنفس السعر. المسودات تبقى مسودات، والكتب المُسترجعة غير المكتملة لا تُنشر.</p>
          <div class="form-group">
            <label for="bulk-price">السعر لكل كتاب (دولار)</label>
            <input id="bulk-price" v-model="bulkPrice" class="form-control" type="text" inputmode="decimal" autocomplete="off" dir="ltr" required :aria-invalid="!!bulkError" aria-describedby="bulk-price-hint" :disabled="bulkBusy" @keydown.enter.prevent="runBulk">
            <small id="bulk-price-hint" class="text-muted">رقم أكبر من صفر، بخانتين عشريتين على الأكثر.</small>
          </div>
        </template>
        <p v-else>سيتم نقل <strong>{{ booksPhrase(sel.count.value) }}</strong> إلى المهملات. لا يُحذف أي سجل ولا ملف، وتبقى الطلبات والمشتريات كما هي، ويمكن استرجاعها لاحقاً.</p>
        <p v-if="bulk !== 'soft_delete'" class="text-muted mb-2"><small>الطلبات السابقة وأسعارها وصلاحيات من اشتروا الكتب لا تتأثر.</small></p>
        <div v-if="bulkError" class="alert alert-danger" role="alert">{{ bulkError }}</div>
      </template>
      <template #footer>
        <button class="btn ripple" :class="bulk && BULK_TEXT[bulk].danger ? 'btn-danger' : 'btn-primary'" type="button" :disabled="bulkBusy" :aria-busy="bulkBusy" @click="runBulk">
          <i v-if="bulkBusy" class="fa fa-spinner fa-spin" /> {{ bulkBusy ? 'جاري التنفيذ…' : 'تأكيد' }}
        </button>
      </template>
    </AdminModal>

    <AdminModal :open="!!target" :title="mode === 'delete' ? 'حذف' : 'استرجاع'" :danger="mode === 'delete'" @close="target = null">
      <div class="form-group"><label>العنوان</label><input readonly class="form-control" :value="target?.title"></div>
      <div v-if="actionError" class="alert alert-danger" role="alert">{{ actionError }}</div>
      <template #footer>
        <button class="btn ripple" :class="mode === 'delete' ? 'btn-danger' : 'btn-success'" type="button" :disabled="busy" @click="confirm">{{ mode === 'delete' ? 'حذف' : 'استرجاع' }}</button>
      </template>
    </AdminModal>
  </div>
</template>

<style scoped>
.bulk-toolbar { position: sticky; top: 0; z-index: 5; display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem 1rem; padding: 0.6rem 1rem; background: #fff; border: 1px solid #b6d4fe; border-radius: 4px; box-shadow: 0 2px 6px rgba(0, 0, 0, 0.08); }
.bulk-actions { display: flex; flex-wrap: wrap; gap: 0.4rem; }
@media (max-width: 575px) { .bulk-actions { width: 100%; } .bulk-actions .btn { flex: 1 1 45%; } }
</style>
