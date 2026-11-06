<script setup lang="ts">
// Port of resources/views/front/invoices.blade.php. Own orders only (RLS, legacy AUTH-18).
import { invoiceNumber, listOrders } from '~~/shared/queries/commerce'
import type { Database } from '~~/shared/types/database.types'

definePageMeta({ middleware: 'auth' })
useHead({ style: [{ innerHTML: '.wp_invoice{height:100vh;background:#fff}' }] })
const client = useSupabaseClient<Database>()
const { data, status, error, refresh } = await useAsyncData('orders', () => listOrders(client), { server: false, default: () => [] })
const date = (iso: string) => new Date(iso).toLocaleDateString('en-CA')
const badge = { paid: ['badge-success', 'نجح'], failed: ['badge-danger', 'فشل'], refunded: ['badge-warning', 'مسترد'] } as const
</script>

<template>
  <div>
    <PageHeading :title="`الفواتير (${data.length})`" />
    <section class="wp_invoice">
      <div class="row">
        <div class="col-12">
          <div v-if="error" class="alert alert-danger" role="alert">تعذر تحميل الفواتير. <a href="#" @click.prevent="refresh()">إعادة المحاولة</a></div>
          <div v-else-if="(status === 'pending' || status === 'idle')" class="text-center p-5" role="status"><i class="fa fa-spinner fa-spin" /> جاري التحميل…</div>
          <div v-else-if="!data.length" class="alert alert-info" role="status">لا توجد فواتير بعد.</div>
          <div v-else id="invoice_sec" class="table-responsive">
            <table class="table table-bordered text-center">
              <thead>
                <tr><th>#</th><th>رقم الفاتورة</th><th>الحالة</th><th>المشتريات</th><th>التاريخ</th></tr>
              </thead>
              <tbody>
                <tr v-for="(o, i) in data" :key="o.id">
                  <td>{{ i + 1 }}</td>
                  <td>
                    <NuxtLink :to="`/invoice/${o.orderNo}`">{{ invoiceNumber(o.orderNo) }}</NuxtLink>
                    <span v-if="o.mode === 'test'" class="badge badge-warning" title="طلب تجريبي (بيئة تطوير)">تجريبي</span>
                  </td>
                  <td><span class="badge" :class="badge[o.status][0]">{{ badge[o.status][1] }}</span></td>
                  <td>{{ o.itemCount }}</td>
                  <td>{{ date(o.createdAt) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
