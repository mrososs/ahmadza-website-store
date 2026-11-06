<script setup lang="ts">
// Generic soft-delete list for categories / makers / articles / pages (port of admin/{category,maker,article,page}/index.blade.php).
type Entity = 'categories' | 'makers' | 'articles' | 'pages'
const props = defineProps<{ entity: Entity }>()

interface Row { id: number; name?: string; title?: string; slug?: string; kind?: string; era?: string; status?: string; is_active?: boolean; view_count?: number; updated_at: string; deleted_at: string | null }
const CFG: Record<Entity, { label: string; viewTo: (r: Row) => string | null; extra: { key: string; label: string; cls?: string }[] }> = {
  categories: { label: 'العنوان', viewTo: (r) => `/search?category=${r.id}`, extra: [] },
  makers: { label: 'الاسم', viewTo: (r) => `/maker/${r.id}`, extra: [{ key: 'kind', label: 'النوع', cls: 'wd-10p' }] },
  articles: { label: 'العنوان', viewTo: (r) => `/post/${r.id}`, extra: [{ key: 'view_count', label: 'الزيارات', cls: 'wd-10p' }] },
  pages: { label: 'العنوان', viewTo: (r) => (r.slug ? `/p/${r.slug}` : null), extra: [{ key: 'slug', label: 'الرابط', cls: 'wd-15p' }] },
}
const cfg = computed(() => CFG[props.entity])
const columns = computed(() => [
  { key: 'id', label: '#', cls: 'wd-5p' }, { key: 'title', label: cfg.value.label, cls: 'wd-30p' }, ...cfg.value.extra,
  { key: 'status', label: 'الحالة', cls: 'wd-10p' }, { key: 'updated_at', label: 'اخر تعديل', cls: 'wd-15p' }, { key: 'ops', label: 'عمليات', cls: 'wd-15p' },
])
const KIND_LABEL: Record<string, string> = { author: 'مؤلف', reader: 'قارئ', writer: 'كاتب' }

const { data, pending, errorText, refresh, query } = useAdminList<Row>(`/api/admin/${props.entity}`)
const trash = computed(() => query.value.status === 'trash')
const isActive = (r: Row) => (r.is_active !== undefined ? r.is_active : r.status === 'published')

const target = ref<Row | null>(null)
const mode = ref<'delete' | 'restore'>('delete')
const busy = ref(false)
const err = ref('')
function ask(r: Row, m: 'delete' | 'restore') { target.value = r; mode.value = m; err.value = '' }
async function confirm() {
  if (!target.value) return
  busy.value = true
  try {
    await adminFetch(`/api/admin/${props.entity}/${target.value.id}${mode.value === 'restore' ? '/restore' : ''}`, { method: mode.value === 'restore' ? 'POST' : 'DELETE' })
    target.value = null
    await refresh()
  } catch (e) { err.value = (e as Error).message } finally { busy.value = false }
}
</script>

<template>
  <div class="row">
    <div class="col-12 text-right mb-3"><NuxtLink class="button" :to="`/admin/${entity}/create`"><i class="fa fa-plus" /> أضافة جديد</NuxtLink></div>
    <div class="col-12 mb-30">
      <AdminDataTable :columns="columns" :rows="data?.items" :loading="pending" :error="errorText" :total="data?.total" :page="data?.page" :page-size="data?.pageSize" searchable @retry="refresh()">
        <template #cell-title="{ row }">{{ row.name ?? row.title }}</template>
        <template #cell-kind="{ row }">{{ KIND_LABEL[row.kind ?? ''] ?? row.kind }}</template>
        <template #cell-status="{ row }">
          <span class="badge" :class="isActive(row) ? 'badge-success' : 'badge-danger'">{{ isActive(row) ? 'مفعلة' : 'غير مفعلة' }}</span>
        </template>
        <template #cell-updated_at="{ row }">{{ fmtDate(row.updated_at) }}</template>
        <template #cell-ops="{ row }">
          <div>
            <button aria-expanded="false" aria-haspopup="true" class="btn ripple btn-sm btn-primary" data-toggle="dropdown" type="button">عمليات <i class="fa fa-caret-down ml-1" /></button>
            <div class="dropdown-menu tx-13">
              <NuxtLink v-if="cfg.viewTo(row)" class="dropdown-item direct-btn" target="_blank" :to="cfg.viewTo(row)!"><i class="fa fa-eye" /> مشاهدة</NuxtLink>
              <template v-if="!trash">
                <NuxtLink class="dropdown-item update-btn" :to="`/admin/${entity}/${row.id}`"><i class="fa fa-edit" /> تعديل</NuxtLink>
                <a class="dropdown-item delete-btn" href="#" @click.prevent="ask(row, 'delete')"><i class="fa fa-trash" /> حذف</a>
              </template>
              <a v-else class="dropdown-item" href="#" @click.prevent="ask(row, 'restore')"><i class="fa fa-undo" /> استرجاع</a>
            </div>
          </div>
        </template>
      </AdminDataTable>
    </div>
    <AdminModal :open="!!target" :title="mode === 'delete' ? 'حذف' : 'استرجاع'" :danger="mode === 'delete'" @close="target = null">
      <div class="form-group"><label>العنوان</label><input readonly class="form-control" :value="target?.name ?? target?.title"></div>
      <div v-if="err" class="alert alert-danger" role="alert">{{ err }}</div>
      <template #footer><button class="btn ripple" :class="mode === 'delete' ? 'btn-danger' : 'btn-success'" type="button" :disabled="busy" @click="confirm">{{ mode === 'delete' ? 'حذف' : 'استرجاع' }}</button></template>
    </AdminModal>
  </div>
</template>
