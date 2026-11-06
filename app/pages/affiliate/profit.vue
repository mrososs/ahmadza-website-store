<script setup lang="ts">
// resources/views/affiliate/user/profit.blade.php — commission list; status derives from available_at.
import type { Database } from '~~/shared/types/database.types'

definePageMeta({ layout: 'affiliate', middleware: ['auth'], title: 'الأرباح' })
useHead({ style: [{ innerHTML: '.table th{text-align:center !important;}' }] })

const client = useSupabaseClient<Database>()
const rows = ref<{ id: string; amount: number; currency: string; available_at: string; created_at: string; is_test: boolean }[]>([])
const loading = ref(true)
const error = ref('')

onMounted(async () => {
  const { data, error: err } = await client.from('affiliate_commissions')
    .select('id,amount,currency,available_at,created_at,is_test').order('created_at', { ascending: false }).limit(500)
  if (err) error.value = 'تعذر تحميل الأرباح'
  rows.value = (data ?? []).map((r) => ({ ...r, amount: Number(r.amount) }))
  loading.value = false
})
</script>

<template>
  <div class="row">
    <div class="col-12 mb-30">
      <div class="card card-statistics h-100">
        <div class="card-body">
          <div v-if="error" class="alert alert-danger" role="alert">{{ error }}</div>
          <div v-else-if="loading" class="text-center p-4" role="status"><i class="fa fa-spinner fa-spin" /> جاري التحميل…</div>
          <div v-else class="table-responsive">
            <table class="table is-striped text-center w-100 data-table">
              <thead>
                <tr>
                  <th class="wd-5p border-bottom-0">#</th>
                  <th class="wd-10p border-bottom-0">الحالة</th>
                  <th class="wd-25p border-bottom-0">صافى الربح</th>
                  <th class="wd-10p border-bottom-0">تاريخ فك الحظر</th>
                  <th class="wd-15p border-bottom-0">تاريخ الطلب</th>
                </tr>
              </thead>
              <tbody>
                <tr v-if="!rows.length"><td colspan="5">لا توجد أرباح بعد</td></tr>
                <tr v-for="(r, i) in rows" :key="r.id">
                  <td class="number_td">{{ i + 1 }}</td>
                  <td>
                    <span v-if="partnerIsAvailable(r.available_at)" class="badge badge-success">متاح</span>
                    <span v-else class="badge badge-warning">قيد الانتظار</span>
                    <span v-if="r.is_test" class="badge badge-secondary">تجريبي</span>
                  </td>
                  <td>{{ partnerMoney(r.amount, r.currency) }}</td>
                  <td>{{ partnerDate(r.available_at) }}</td>
                  <td>{{ partnerDate(r.created_at) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
