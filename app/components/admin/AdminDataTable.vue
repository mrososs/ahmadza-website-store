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
}>()
const emit = defineEmits<{ retry: [] }>()

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
              <tr><th v-for="c in columns" :key="c.key" class="border-bottom-0" :class="c.cls">{{ c.label }}</th></tr>
            </thead>
            <tbody>
              <tr v-if="!rows && !error"><td :colspan="columns.length" class="text-center p-4" role="status"><i class="fa fa-spinner fa-spin" /> جاري التحميل…</td></tr>
              <tr v-else-if="error">
                <td :colspan="columns.length" class="text-center p-4 text-danger" role="alert">
                  {{ error }} <a href="#" @click.prevent="emit('retry')">إعادة المحاولة</a>
                  <template v-if="route.query.page"> | <NuxtLink :to="{ path: route.path, query: { ...route.query, page: undefined } }">الصفحة الأولى</NuxtLink></template>
                </td>
              </tr>
              <tr v-else-if="!rows?.length">
                <td :colspan="columns.length" class="text-center p-4">
                  <template v-if="applied">لا توجد نتائج مطابقة لبحثك. <a href="#" @click.prevent="clearSearch">مسح البحث</a></template>
                  <template v-else>لا توجد بيانات</template>
                </td>
              </tr>
              <template v-else>
                <tr v-for="(r, i) in rows" :key="keyOf(r, i)">
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
</style>
