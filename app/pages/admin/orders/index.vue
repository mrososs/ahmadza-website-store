<script setup lang="ts">
// Orders list. READ-ONLY by design: orders are append-only and admins cannot change an order's status (docs 07).
definePageMeta({ layout: 'admin', middleware: ['admin'] })
useAdminTitle('الطلبات')

interface Row { id: string; order_no: number; status: string; mode: string; total_amount: number; currency: string; created_at: string; profiles: { display_name: string } | null }
const { data, pending, errorText, refresh } = useAdminList<Row>('/api/admin/orders')
const columns = [
  { key: 'n', label: '#', cls: 'wd-5p' }, { key: 'order_no', label: 'الفاتورة' }, { key: 'buyer', label: 'المشترى' },
  { key: 'status', label: 'الحالة' }, { key: 'total', label: 'التكلفة' }, { key: 'created_at', label: 'التاريخ' },
]
const STATUS: Record<string, { l: string; c: string }> = { paid: { l: 'نجح', c: 'badge-success' }, failed: { l: 'فشل', c: 'badge-danger' }, refunded: { l: 'مسترد', c: 'badge-warning' } }
</script>

<template>
  <div class="row">
    <div class="col-12 mb-30">
      <AdminDataTable :columns="columns" :rows="data?.items" :loading="pending" :error="errorText" :total="data?.total" :page="data?.page" :page-size="data?.pageSize" searchable search-placeholder="رقم الفاتورة" @retry="refresh()">
        <template #cell-n="{ index }">{{ ((data?.page ?? 1) - 1) * (data?.pageSize ?? 20) + index + 1 }}</template>
        <template #cell-order_no="{ row }"><NuxtLink :to="`/admin/invoice/${row.order_no}`">#{{ String(row.order_no).padStart(6, '0') }}</NuxtLink></template>
        <template #cell-buyer="{ row }">{{ row.profiles?.display_name }}</template>
        <template #cell-status="{ row }">
          <span class="badge" :class="STATUS[row.status]?.c">{{ STATUS[row.status]?.l ?? row.status }}</span>
          <span v-if="row.mode === 'test'" class="badge badge-secondary">تجريبي</span>
        </template>
        <template #cell-total="{ row }">{{ Number(row.total_amount).toFixed(2) }} {{ row.currency }}</template>
        <template #cell-created_at="{ row }">{{ fmtDateTime(row.created_at) }}</template>
      </AdminDataTable>
    </div>
  </div>
</template>
