<script setup lang="ts">
// Port of admin/invoice/index.blade.php (read-only).
definePageMeta({ layout: 'admin', middleware: ['admin'] })
const no = String(useRoute().params.no)

interface Detail {
  order_no: number; status: string; mode: string; total_amount: number; currency: string; created_at: string; user_id: string; email: string | null
  profiles: { display_name: string } | null
  items: { id: number; book_id: number | null; title_snapshot: string; unit_price: number }[]
  payment: { provider: string; status: string; reference: string } | null
}
const { data: o, error, refresh } = await useFetch<Detail>(`/api/admin/orders/${no}`, { server: false, key: `admin-order-${no}` })
useAdminTitle(() => `الفاتورة - ${String(no).padStart(6, '0')}#`)
const STATUS: Record<string, { l: string; c: string }> = { paid: { l: 'نجح', c: 'badge-success' }, failed: { l: 'فشل', c: 'badge-danger' }, refunded: { l: 'مسترد', c: 'badge-warning' } }
</script>

<template>
  <section class="wp_invoice">
    <div v-if="error" class="alert alert-danger" role="alert">{{ adminErrorMessage(error) }} <a href="#" @click.prevent="refresh()">إعادة المحاولة</a></div>
    <div v-else-if="!o" class="text-center p-5" role="status"><i class="fa fa-spinner fa-spin" /> جاري التحميل…</div>
    <div v-else class="row">
      <div class="col-12">
        <div id="invoice_sec" class="table-responsive">
          <table class="table table-bordered">
            <tbody>
              <tr><td class="key">رقم الفاتورة</td><td class="value">#{{ String(o.order_no).padStart(6, '0') }}</td></tr>
              <tr><td class="key">الحالة</td><td class="value"><span class="badge" :class="STATUS[o.status]?.c">{{ STATUS[o.status]?.l ?? o.status }}</span> <span v-if="o.mode === 'test'" class="badge badge-secondary">طلب تجريبي (بيانات اختبار)</span></td></tr>
              <tr><td class="key">المشترى</td><td class="value"><NuxtLink :to="`/admin/users/${o.user_id}`">{{ o.profiles?.display_name }}</NuxtLink> <span dir="ltr">{{ o.email }}</span></td></tr>
              <tr><td class="key">التكلفة</td><td class="value">{{ Number(o.total_amount).toFixed(2) }} <sub>{{ o.currency }}</sub></td></tr>
              <tr><td class="key">طريقة الدفع</td><td class="value">{{ o.payment ? `${o.payment.provider} (${o.payment.status})` : '-' }}</td></tr>
              <tr><td class="key">التاريخ</td><td class="value">{{ fmtDate(o.created_at) }}</td></tr>
              <tr><td class="key">الوقت</td><td class="value">{{ o.created_at.slice(11, 16) }}</td></tr>
              <tr>
                <td class="key">المشتريات</td>
                <td class="value">
                  <ul class="list-unstyled">
                    <li v-for="i in o.items" :key="i.id">
                      <NuxtLink v-if="i.book_id" target="_blank" :to="`/admin/books/${i.book_id}/media`">{{ i.title_snapshot }}</NuxtLink><template v-else>{{ i.title_snapshot }}</template>
                      — {{ Number(i.unit_price).toFixed(2) }}
                    </li>
                  </ul>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </section>
</template>
