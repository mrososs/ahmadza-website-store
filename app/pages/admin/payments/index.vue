<script setup lang="ts">
// Payments reconciliation list. READ-ONLY: payment state is changed only by the trusted database functions / gateway callbacks.
definePageMeta({ layout: 'admin', middleware: ['admin'] })
useAdminTitle('المدفوعات')

interface Row {
  id: string; reference: string; provider: string; provider_transaction_id: string | null; status: string; amount: number; currency: string; mode: string
  created_at: string; paid_at: string | null; order_no: number | null; events: number; stale: boolean; profiles: { display_name: string } | null
}
const { data, pending, errorText, refresh } = useAdminList<Row>('/api/admin/payments')
const columns = [
  { key: 'n', label: '#', cls: 'wd-5p' }, { key: 'reference', label: 'المرجع' }, { key: 'buyer', label: 'المشترى' }, { key: 'provider', label: 'البوابة' },
  { key: 'status', label: 'الحالة' }, { key: 'amount', label: 'المبلغ' }, { key: 'order', label: 'الفاتورة' }, { key: 'created_at', label: 'التاريخ' },
]
const STATUS: Record<string, { l: string; c: string }> = {
  pending: { l: 'قيد الانتظار', c: 'badge-warning' }, succeeded: { l: 'ناجحة', c: 'badge-success' }, failed: { l: 'فشلت', c: 'badge-danger' },
  cancelled: { l: 'ملغاة', c: 'badge-secondary' }, expired: { l: 'منتهية', c: 'badge-secondary' },
}
const PROVIDER: Record<string, string> = { paymob: 'Paymob', tap: 'Tap', dev_simulator: 'محاكاة تطوير' }
</script>

<template>
  <div class="row">
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
