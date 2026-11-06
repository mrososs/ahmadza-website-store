<script setup lang="ts">
// resources/views/admin/request-book/index.blade.php — contributor submissions (status filter via ?status=).
import { CONTRIBUTOR_DEAL_LABEL, CONTRIBUTOR_STATUS_LABEL } from '~~/shared/constants'

definePageMeta({ layout: 'admin', middleware: ['admin'] })
useAdminTitle('طلبات اضافة الكتب')
useHead({ style: [{ innerHTML: '.table th{text-align:center !important;}' }] })

interface Row { id: string; title: string; deal: 'share' | 'rent'; cost: number | null; currency: string; whatsapp: string | null; status: 'pending' | 'approved' | 'declined'; created_at: string; ownerName: string }
const route = useRoute()
const filter = computed(() => (typeof route.query.status === 'string' ? route.query.status : ''))
const { data, error, status } = await useAsyncData(
  () => `admin-request-books:${filter.value}`,
  () => $fetch<Row[]>('/api/admin/request-books', { query: filter.value ? { status: filter.value } : {} }),
  { server: false, watch: [filter] },
)
const BADGE = { pending: 'badge-warning', approved: 'badge-success', declined: 'badge-danger' } as const
const LABEL = { pending: 'مراجعة', approved: 'موافقة', declined: 'رفض' } as const
const tabs = [{ v: '', l: 'الكل' }, { v: 'pending', l: 'مراجعة' }, { v: 'approved', l: 'موافقة' }, { v: 'declined', l: 'رفض' }]
</script>

<template>
  <div class="row">
    <div class="col-12 mb-3">
      <NuxtLink v-for="t in tabs" :key="t.v" class="btn btn-sm ml-1" :class="filter === t.v ? 'btn-primary' : 'btn-outline-primary'" :to="{ path: '/admin/request-books', query: t.v ? { status: t.v } : {} }">{{ t.l }}</NuxtLink>
    </div>
    <div class="col-12 mb-30">
      <div v-if="error" class="alert alert-danger" role="alert">{{ partnerErrorMessage(error) }}</div>
      <div class="card card-statistics h-100">
        <div class="card-body">
          <div v-if="status === 'pending' && !data" class="text-center p-4" role="status"><i class="fa fa-spinner fa-spin" /> جاري التحميل…</div>
          <div v-else class="table-responsive">
            <table class="table is-striped text-center w-100 data-table">
              <thead>
                <tr>
                  <th class="wd-5p border-bottom-0">#</th>
                  <th class="wd-25p border-bottom-0">الأسم</th>
                  <th class="wd-20p border-bottom-0">واتساب</th>
                  <th class="wd-10p border-bottom-0">اسم الكتاب</th>
                  <th class="wd-10p border-bottom-0">نوع الإتفاقية</th>
                  <th class="wd-10p border-bottom-0">التكلفة</th>
                  <th class="wd-10p border-bottom-0">الحالة</th>
                  <th class="wd-15p border-bottom-0">التاريخ</th>
                  <th class="wd-15p border-bottom-0">العمليات</th>
                </tr>
              </thead>
              <tbody>
                <tr v-if="!data?.length"><td colspan="9">لا توجد طلبات</td></tr>
                <tr v-for="(r, i) in data ?? []" :key="r.id">
                  <td class="number_td">{{ i + 1 }}</td>
                  <td>{{ r.ownerName }}</td>
                  <td dir="ltr">{{ r.whatsapp || '-' }}</td>
                  <td>{{ r.title }}</td>
                  <td>{{ CONTRIBUTOR_DEAL_LABEL[r.deal] }}</td>
                  <td>{{ r.cost ? partnerMoney(r.cost, r.currency) : 'مجانى' }}</td>
                  <td><span class="badge" :class="BADGE[r.status]">{{ LABEL[r.status] }}</span></td>
                  <td>{{ partnerDate(r.created_at) }}</td>
                  <td>
                    <div>
                      <button aria-expanded="false" aria-haspopup="true" class="btn ripple btn-sm btn-primary" data-toggle="dropdown" type="button">عمليات <i class="fa fa-caret-down ml-1" /></button>
                      <div class="dropdown-menu tx-13">
                        <NuxtLink class="dropdown-item" :to="`/admin/request-books/${r.id}`"><i class="fa fa-eye" /> عرض</NuxtLink>
                      </div>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p class="text-muted mt-2 mb-0">الحالات: {{ Object.values(CONTRIBUTOR_STATUS_LABEL).join(' / ') }}</p>
        </div>
      </div>
    </div>
  </div>
</template>
