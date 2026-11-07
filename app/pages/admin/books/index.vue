<script setup lang="ts">
// Port of admin/book/index.blade.php (status filter via the sidebar: ?status=active|inactive|soon|trash).
definePageMeta({ layout: 'admin', middleware: ['admin'] })
useAdminTitle('الكتب')
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
    <div class="col-12 mb-30">
      <AdminDataTable :columns="columns" :rows="data?.items" :loading="pending" :error="errorText" :total="data?.total" :page="data?.page" :page-size="data?.pageSize" searchable search-placeholder="ابحث بعنوان الكتاب" @retry="refresh()">
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

    <AdminModal :open="!!target" :title="mode === 'delete' ? 'حذف' : 'استرجاع'" :danger="mode === 'delete'" @close="target = null">
      <div class="form-group"><label>العنوان</label><input readonly class="form-control" :value="target?.title"></div>
      <div v-if="actionError" class="alert alert-danger" role="alert">{{ actionError }}</div>
      <template #footer>
        <button class="btn ripple" :class="mode === 'delete' ? 'btn-danger' : 'btn-success'" type="button" :disabled="busy" @click="confirm">{{ mode === 'delete' ? 'حذف' : 'استرجاع' }}</button>
      </template>
    </AdminModal>
  </div>
</template>
