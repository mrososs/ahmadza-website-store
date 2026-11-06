<script setup lang="ts">
// Port of admin/statistics/{user,book,order,revenue}.blade.php (ADM-05..09): date-range filter, table, CSV export.
// Orders / revenue default to LIVE mode so test data never inflates reported money.
definePageMeta({ layout: 'admin', middleware: ['admin'] })
const route = useRoute()
const kind = computed(() => String(route.params.kind))
const TITLES: Record<string, string> = { users: 'تقارير المستخدمين', books: 'تقارير الكتب', orders: 'تقارير الطلبات', revenue: 'تقارير الأرباح' }
useAdminTitle(() => TITLES[kind.value] ?? 'تقارير')

const from = ref(''), to = ref(''), mode = ref<'live' | 'test' | 'all'>('live')
const applied = reactive({ from: '', to: '', mode: 'live' as string })
interface Report { kind: string; count: number; totals: Record<string, number>; rows: Record<string, string | number | null>[] }
const { data, pending, error, refresh } = useFetch<Report>(() => `/api/admin/stats/${kind.value}`, {
  server: false, query: computed(() => ({ from: applied.from || undefined, to: applied.to || undefined, mode: applied.mode })), watch: [kind],
})
const cols = computed(() => Object.keys(data.value?.rows[0] ?? {}))
const LABELS: Record<string, string> = {
  id: '#', name: 'الاسم', status: 'الحالة', affiliate: 'مسوق', created_at: 'التاريخ', title: 'العنوان', kind: 'النوع', price: 'السعر', currency: 'العملة', views: 'المشاهدات',
  invoice: 'الفاتورة', mode: 'الوضع', total: 'الإجمالي', book: 'الكتاب', unit_price: 'سعر الوحدة',
}
const showMode = computed(() => kind.value === 'orders' || kind.value === 'revenue')
function apply() { applied.from = from.value; applied.to = to.value; applied.mode = mode.value }
const csvUrl = computed(() => {
  const p = new URLSearchParams({ format: 'csv', mode: applied.mode })
  if (applied.from) p.set('from', applied.from)
  if (applied.to) p.set('to', applied.to)
  return `/api/admin/stats/${kind.value}?${p}`
})
const totals = computed(() => Object.entries(data.value?.totals ?? {}).map(([c, v]) => `${v.toFixed(2)} ${c}`).join(' + '))
</script>

<template>
  <section class="wp_statistics">
    <div class="row">
      <div class="col-12">
        <div class="filter_search">
          <form @submit.prevent="apply">
            <div class="row">
              <div class="col-md-3"><input v-model="from" type="date" class="form-control" aria-label="من تاريخ"></div>
              <div class="col-md-3"><input v-model="to" type="date" class="form-control" aria-label="إلى تاريخ"></div>
              <div v-if="showMode" class="col-md-2">
                <AdminSelect :model-value="mode" @update:model-value="mode = $event as never" title="الوضع" :options="[{ value: 'live', label: 'حقيقية فقط' }, { value: 'test', label: 'تجريبية' }, { value: 'all', label: 'الكل' }]" />
              </div>
              <div class="col-md-2"><button class="btn btn-block btn-success" type="submit"><i class="fa fa-filter" /> عرض</button></div>
              <div class="col-md-2"><a class="btn btn-block btn-primary" :href="csvUrl" download><i class="fa fa-download" /> تصدير ملف</a></div>
            </div>
          </form>
        </div>
      </div>
      <div class="col-12">
        <div v-if="totals" class="alert alert-info mt-3" role="status">الإجمالي: {{ totals }}</div>
        <div class="card card-statistics h-100">
          <div class="card-body">
            <div class="table-responsive">
              <table class="table table-striped table-bordered p-0">
                <thead><tr><th v-for="c in cols" :key="c" class="border-bottom-0">{{ LABELS[c] ?? c }}</th></tr></thead>
                <tbody>
                  <tr v-if="pending && !data"><td class="text-center p-4" :colspan="cols.length || 1" role="status"><i class="fa fa-spinner fa-spin" /> جاري التحميل…</td></tr>
                  <tr v-else-if="error"><td class="text-center p-4 text-danger" :colspan="cols.length || 1" role="alert">{{ adminErrorMessage(error) }} <a href="#" @click.prevent="refresh()">إعادة المحاولة</a></td></tr>
                  <tr v-else-if="!data?.rows.length"><td class="text-center p-4" :colspan="cols.length || 1">لا توجد بيانات</td></tr>
                  <template v-else><tr v-for="(r, i) in data?.rows" :key="i"><td v-for="c in cols" :key="c">{{ c === 'created_at' ? fmtDate(String(r[c])) : r[c] }}</td></tr></template>
                </tbody>
              </table>
            </div>
            <div v-if="data" class="dataTables_info mt-2">عدد السجلات: {{ data.count }}</div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
