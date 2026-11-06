<script setup lang="ts">
// Payments reconciliation list. READ-ONLY: payment state is changed only by the trusted database functions / gateway callbacks.
definePageMeta({ layout: 'admin', middleware: ['admin'] })
useAdminTitle('المدفوعات')

interface Row {
  id: string; reference: string; provider: string; provider_transaction_id: string | null; status: string; amount: number; currency: string; mode: string
  created_at: string; paid_at: string | null; order_no: number | null; events: number; stale: boolean; needs_review: boolean; review_reason: string | null; profiles: { display_name: string } | null
}
interface Gateway { id: string; label: string; enabled: boolean; configured: boolean; missing: string[]; available: boolean; reason: string | null; verified: boolean; currency: { store: string; gateway: string; matches: boolean } }
interface Gateways { mode: string; currency: string; allowTestPayments: boolean; liveEnabled: boolean; origin: { value: string; https: boolean; problem: string | null; note: string }; webhookUrls: Record<string, string>; providers: Gateway[] }
const { data: gateways } = useFetch<Gateways>('/api/admin/payments/gateways', { server: false })
const showGateways = ref(true)
const route = useRoute()
const review = computed(() => (route.query.review === 'needs_review' ? 'needs_review' : undefined))
const { data, pending, errorText, refresh } = useAdminList<Row>('/api/admin/payments', () => ({ review: review.value }))
const setReview = (on: boolean) => navigateTo({ query: { ...route.query, page: undefined, review: on ? 'needs_review' : undefined } })
const columns = [
  { key: 'n', label: '#', cls: 'wd-5p' }, { key: 'reference', label: 'المرجع' }, { key: 'buyer', label: 'المشترى' }, { key: 'provider', label: 'البوابة' },
  { key: 'status', label: 'الحالة' }, { key: 'amount', label: 'المبلغ' }, { key: 'order', label: 'الفاتورة' }, { key: 'created_at', label: 'التاريخ' },
]
const STATUS: Record<string, { l: string; c: string }> = {
  pending: { l: 'قيد الانتظار', c: 'badge-warning' }, succeeded: { l: 'ناجحة', c: 'badge-success' }, failed: { l: 'فشلت', c: 'badge-danger' },
  cancelled: { l: 'ملغاة', c: 'badge-secondary' }, expired: { l: 'منتهية', c: 'badge-secondary' },
}
const checking = ref('')
const checkMsg = ref('')
async function recheck(row: Row) {
  checking.value = row.id; checkMsg.value = ''
  try {
    const r = await adminFetch<{ status: string; outcome: string }>(`/api/admin/payments/${row.id}/recheck`, { method: 'POST' })
    checkMsg.value = r.outcome === 'fulfilled' ? 'تم التأكد من الدفع وإنشاء الطلب' : r.outcome === 'failed' ? 'أكدت البوابة أن العملية لم تنجح' : r.outcome === 'pending' ? 'ما زالت العملية قيد الانتظار لدى البوابة' : r.outcome === 'needs_review' ? 'تحتاج العملية إلى مراجعة يدوية' : 'لا تغيير'
    await refresh()
  } catch (e) { checkMsg.value = (e as Error).message } finally { checking.value = '' }
}
const PROVIDER: Record<string, string> = { paymob: 'Paymob', tap: 'Tap', dev_simulator: 'محاكاة تطوير' }
</script>

<template>
  <div class="row">
    <div v-if="gateways" class="col-12 mb-30">
      <div class="card"><div class="card-body">
        <h5 class="card-title">
          بوابات الدفع
          <button type="button" class="btn btn-sm btn-light float-left" :aria-expanded="showGateways" @click="showGateways = !showGateways">{{ showGateways ? 'إخفاء' : 'إظهار' }}</button>
        </h5>
        <div v-if="showGateways">
          <p class="mb-2">
            الوضع الحالي: <span class="badge" :class="gateways.mode === 'live' ? 'badge-danger' : 'badge-secondary'">{{ gateways.mode === 'live' ? 'حقيقي' : 'تجريبي' }}</span>
            — عملة المتجر: <strong>{{ gateways.currency }}</strong> (لا يتم أي تحويل للعملة)
            — الدفع الحقيقي: <span class="badge" :class="gateways.liveEnabled ? 'badge-warning' : 'badge-success'">{{ gateways.liveEnabled ? 'مفعّل' : 'مغلق' }}</span>
          </p>
          <div v-if="!gateways.origin.https" class="alert alert-warning" role="status">{{ gateways.origin.note }}</div>
          <div class="table-responsive">
            <table class="table table-sm mb-2">
              <thead><tr><th>البوابة</th><th>الحالة</th><th>ما ينقص (أسماء المتغيرات فقط)</th><th>التحقق</th><th>رابط الـ Webhook</th></tr></thead>
              <tbody>
                <tr v-for="g in gateways.providers" :key="g.id">
                  <td>{{ g.label }}</td>
                  <td>
                    <span class="badge" :class="g.available ? 'badge-success' : 'badge-secondary'">{{ g.available ? 'جاهزة' : 'غير متاحة' }}</span>
                    <small v-if="g.reason" class="d-block text-muted" dir="ltr">{{ g.reason }}</small>
                  </td>
                  <td dir="ltr"><code v-for="m in g.missing" :key="m" class="d-block">{{ m }}</code><span v-if="!g.missing.length">—</span></td>
                  <td><span class="badge" :class="g.verified ? 'badge-success' : 'badge-warning'">{{ g.verified ? 'تم التحقق' : 'NOT VERIFIED' }}</span></td>
                  <td dir="ltr"><code v-if="gateways.webhookUrls[g.id]">{{ gateways.webhookUrls[g.id] }}</code><span v-else>—</span></td>
                </tr>
              </tbody>
            </table>
          </div>
          <p class="text-muted mb-0">لا تُعرض هنا أي مفاتيح. الدفع الحقيقي يتطلب تفعيلاً صريحاً وتحققاً من البوابة: راجع قائمة التفعيل في التوثيق.</p>
        </div>
      </div></div>
    </div>
    <div v-if="checkMsg" class="col-12"><div class="alert alert-info" role="status">{{ checkMsg }}</div></div>
    <div class="col-12 mb-3">
      <label class="mr-2"><input type="checkbox" :checked="review === 'needs_review'" @change="setReview(($event.target as HTMLInputElement).checked)"> عرض العمليات التي تحتاج مراجعة فقط</label>
    </div>
    <div class="col-12 mb-30">
      <AdminDataTable :columns="columns" :rows="data?.items" :loading="pending" :error="errorText" :total="data?.total" :page="data?.page" :page-size="data?.pageSize" searchable search-placeholder="المرجع أو رقم العملية" @retry="refresh()">
        <template #cell-n="{ index }">{{ ((data?.page ?? 1) - 1) * (data?.pageSize ?? 20) + index + 1 }}</template>
        <template #cell-reference="{ row }"><code>{{ row.reference.slice(0, 8) }}</code></template>
        <template #cell-buyer="{ row }">{{ row.profiles?.display_name }}</template>
        <template #cell-provider="{ row }">{{ PROVIDER[row.provider] ?? row.provider }}</template>
        <template #cell-status="{ row }">
          <span class="badge" :class="STATUS[row.status]?.c">{{ STATUS[row.status]?.l ?? row.status }}</span>
          <span v-if="row.mode === 'test'" class="badge badge-secondary">تجريبي</span>
          <span v-if="row.stale" class="badge badge-danger" title="انتهت مهلتها وما زالت قيد الانتظار">متروكة</span>
          <span v-if="row.needs_review" class="badge badge-danger" :title="row.review_reason ?? ''">تحتاج مراجعة</span>
          <button v-if="row.status === 'pending' && row.provider === 'tap'" type="button" class="btn btn-sm btn-light" :disabled="checking === row.id" @click="recheck(row)">
            <i class="fa" :class="checking === row.id ? 'fa-spinner fa-spin' : 'fa-refresh'" /> تحقق من البوابة
          </button>
        </template>
        <template #cell-amount="{ row }">{{ Number(row.amount).toFixed(2) }} {{ row.currency }}</template>
        <template #cell-order="{ row }">
          <NuxtLink v-if="row.order_no" :to="`/admin/invoice/${row.order_no}`">#{{ String(row.order_no).padStart(6, '0') }}</NuxtLink>
          <span v-else>—</span>
        </template>
        <template #cell-created_at="{ row }">{{ fmtDateTime(row.created_at) }}</template>
      </AdminDataTable>
    </div>
  </div>
</template>
