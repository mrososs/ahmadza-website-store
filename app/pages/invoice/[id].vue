<script setup lang="ts">
// Port of resources/views/front/cart/invoice.blade.php. Visible to the owner (and admins) only — enforced by RLS (AUTH-18).
import { getOrderByNo, invoiceNumber } from '~~/shared/queries/commerce'
import type { Database } from '~~/shared/types/database.types'

definePageMeta({ middleware: 'auth' })
useHead({
  style: [{
    innerHTML: `.wp_invoice{height:100vh;background:#fff}.wp_invoice table tr td.key{color:rgb(64,69,83);font-family:'Cairo-Bold'}.wp_invoice table tr td.value{color:rgb(64,69,83)}.wp_invoice table tr td sub{color:rgb(126,133,155);font-size:11px}.wp_invoice table tr td ul{padding:0;margin:0;list-style:none}.wp_invoice table tr td ul li{margin-bottom:7px}.wp_invoice table tr td ul li:last-child{margin-bottom:0}.wp_invoice table tr td ul li::before{content:'-';margin-left:5px;color:#000}.wp_invoice table tr td ul li a{color:#7275ed;text-decoration:none;font-size:15px}`,
  }],
})
const route = useRoute()
const client = useSupabaseClient<Database>()
const { info } = useSessionInfo()
const cart = useCartStore()
onMounted(() => { if (route.query.purchased === '1') cart.clear() }) // the purchase emptied the basket: drop it locally too (header counter, /cart)
const no = Number(route.params.id)
const { data: order, status, error } = await useAsyncData(`invoice-${no}`, async () => (Number.isInteger(no) && no > 0 ? getOrderByNo(client, no) : null), { server: false })

const dt = computed(() => (order.value ? new Date(order.value.created_at) : null))
const badge = { paid: ['badge-success', 'نجح'], failed: ['badge-danger', 'فشل'], refunded: ['badge-warning', 'مسترد'] } as const
const print = () => window.print()
const title = computed(() => (order.value ? `فاتورتك - ${invoiceNumber(order.value.order_no)}` : 'الفاتورة'))
</script>

<template>
  <div>
    <PageHeading :title="title" />
    <section class="wp_invoice">
      <div class="row">
        <div v-if="(status === 'pending' || status === 'idle')" class="col-12 text-center p-5" role="status"><i class="fa fa-spinner fa-spin" /> جاري التحميل…</div>
        <div v-else-if="error || !order" class="col-12"><div class="alert alert-danger" role="alert">الفاتورة غير موجودة.</div></div>
        <template v-else>
          <div class="col-12">
            <div v-if="route.query.purchased === '1'" class="alert alert-success alert-block" role="status">
              تم عملية الشراء بنجاح , تم اضافة مشترياتك الى
              <NuxtLink to="/library">المكتبة</NuxtLink>
              الخاصة بك
            </div>
            <div v-if="order.mode === 'test'" class="alert alert-warning" role="note">طلب تجريبي (بيئة تطوير) — لم يتم أي دفع حقيقي.</div>
          </div>
          <div class="col-12">
            <div id="invoice_sec" class="table-responsive">
              <table class="table table-bordered">
                <tbody>
                  <tr><td class="key">رقم الفاتورة</td><td class="value">{{ invoiceNumber(order.order_no) }}</td></tr>
                  <tr><td class="key">الحالة</td><td class="value"><span class="badge" :class="badge[order.status][0]">{{ badge[order.status][1] }}</span></td></tr>
                  <tr><td class="key">المشترى</td><td class="value">{{ info?.displayName || info?.email }}</td></tr>
                  <tr><td class="key">التكلفة</td><td class="value">{{ Number(order.total_amount).toFixed(2) }} <sub>دولار</sub></td></tr>
                  <tr><td class="key">التاريخ</td><td class="value">{{ dt?.toLocaleDateString('en-CA') }}</td></tr>
                  <tr><td class="key">الوقت</td><td class="value">{{ dt?.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) }}</td></tr>
                  <tr>
                    <td class="key">المشتريات</td>
                    <td class="value">
                      <ul class="list-unstyled">
                        <li v-for="it in order.order_items" :key="it.id">
                          <NuxtLink v-if="it.book_id" :to="`/book/${it.book_id}`">{{ it.title_snapshot }}</NuxtLink>
                          <span v-else>{{ it.title_snapshot }}</span>
                          <sub>{{ Number(it.unit_price).toFixed(2) }}</sub>
                        </li>
                      </ul>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div class="text-right">
              <button type="button" class="wp_btn" @click="print"><i class="fa fa-print" /> طباعة</button>
            </div>
          </div>
        </template>
      </div>
    </section>
  </div>
</template>
