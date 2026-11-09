<script setup lang="ts" generic="T extends Record<string, any>">
// Legacy admin list: .card.card-statistics > .card-body > .table-responsive > table.table-striped.table-bordered
// (the DataTables look) with server-side search + pagination, and explicit loading / error / empty states.
export interface Column { key: string; label: string; cls?: string }

const props = defineProps<{
  columns: Column[]
  rows: T[] | undefined
  loading?: boolean
  error?: string
  total?: number
  page?: number
  pageSize?: number
  searchable?: boolean
  searchPlaceholder?: string
  rowKey?: string
  /** Adds a leading checkbox column. The parent owns the selection (it must survive paging), the table only reports ticks. */
  selectable?: boolean
  isSelected?: (row: T) => boolean
  pageState?: 'none' | 'some' | 'all'
  selectLabel?: (row: T) => string
}>()
const emit = defineEmits<{ retry: []; select: [row: T, checked: boolean]; 'select-page': [checked: boolean] }>()
const span = computed(() => props.columns.length + (props.selectable ? 1 : 0))
const headBox = ref<HTMLInputElement | null>(null)
watchEffect(() => { if (headBox.value) headBox.value.indeterminate = props.pageState === 'some' })

const route = useRoute()
const router = useRouter()
const term = ref(typeof route.query.q === 'string' ? route.query.q : '')
watch(() => route.query.q, (q) => { term.value = typeof q === 'string' ? q : '' })
const applied = computed(() => (typeof route.query.q === 'string' ? route.query.q.trim() : ''))
function clearSearch() { term.value = ''; search() }
function search() { router.push({ path: route.path, query: { ...route.query, q: term.value.trim() || undefined, page: undefined } }) }

const from = computed(() => (props.rows?.length ? ((props.page ?? 1) - 1) * (props.pageSize ?? 20) + 1 : 0))
const to = computed(() => from.value + (props.rows?.length ?? 1) - 1)
const keyOf = (r: T, i: number) => String(r[props.rowKey ?? 'id'] ?? i)
</script>

<template>
  <div class="card card-statistics h-100">
    <div class="card-body">
      <div class="dataTables_wrapper">
        <div v-if="searchable" class="dataTables_filter text-left mb-2">
          <form role="search" @submit.prevent="search">
            <label>
              بحث:
              <input v-model="term" type="search" class="form-control form-control-sm d-inline-block" style="width: 220px" :placeholder="searchPlaceholder ?? 'بحث...'" aria-label="بحث">
            </label>
            <button class="btn btn-sm btn-primary" type="submit"><i class="fa fa-search" /></button>
          </form>
        </div>
        <div class="table-responsive">
          <table class="table table-striped table-bordered p-0 admin-data-table">
            <thead>
              <tr>
                <th v-if="selectable" class="border-bottom-0 select-col" scope="col">
                  <input ref="headBox" type="checkbox" aria-label="تحديد كل عناصر هذه الصفحة" :checked="pageState === 'all'" :disabled="!rows?.length" @change="emit('select-page', ($event.target as HTMLInputElement).checked)">
                </th>
                <th v-for="c in columns" :key="c.key" class="border-bottom-0" :class="c.cls">{{ c.label }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!rows && !error"><td :colspan="span" class="text-center p-4" role="status"><i class="fa fa-spinner fa-spin" /> جاري التحميل…</td></tr>
              <tr v-else-if="error">
                <td :colspan="span" class="text-center p-4 text-danger" role="alert">
                  {{ error }} <a href="#" @click.prevent="emit('retry')">إعادة المحاولة</a>
                  <template v-if="route.query.page"> | <NuxtLink :to="{ path: route.path, query: { ...route.query, page: undefined } }">الصفحة الأولى</NuxtLink></template>
                </td>
              </tr>
              <tr v-else-if="!rows?.length">
                <td :colspan="span" class="text-center p-4">
                  <template v-if="applied">لا توجد نتائج مطابقة لبحثك. <a href="#" @click.prevent="clearSearch">مسح البحث</a></template>
                  <template v-else>لا توجد بيانات</template>
                </td>
              </tr>
              <template v-else>
                <tr v-for="(r, i) in rows" :key="keyOf(r, i)" :class="{ 'row-selected': selectable && isSelected?.(r) }">
                  <td v-if="selectable" class="select-col">
                    <input type="checkbox" :aria-label="selectLabel?.(r) ?? 'تحديد الصف'" :checked="!!isSelected?.(r)" @change="emit('select', r, ($event.target as HTMLInputElement).checked)">
                  </td>
                  <td v-for="c in columns" :key="c.key">
                    <slot :name="`cell-${c.key}`" :row="r" :index="i">{{ r[c.key] }}</slot>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
        <div v-if="total !== undefined && total > 0" class="dataTables_info mt-2">عرض {{ from }} إلى {{ to }} من {{ total }} سجل</div>
        <AdminPagination v-if="total !== undefined" :page="page ?? 1" :total="total" :page-size="pageSize ?? 20" />
      </div>
    </div>
  </div>
</template>

<style>
/* on a phone the columns keep a readable width and the .table-responsive wrapper scrolls sideways (instead of one word per line and cut-off badges) */
.admin-data-table { min-width: 760px; }
.admin-data-table .select-col { width: 2.5rem; text-align: center; vertical-align: middle; }
.admin-data-table .select-col input { width: 1.1rem; height: 1.1rem; cursor: pointer; }
.admin-data-table tr.row-selected > td { background-color: rgba(0, 123, 255, 0.08); }
</style>
