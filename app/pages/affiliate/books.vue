<script setup lang="ts">
// resources/views/affiliate/user/book.blade.php — books with attributed orders and a copy-able marketing link.
definePageMeta({ layout: 'affiliate', middleware: ['auth'], title: 'الكتب' })
useHead({ style: [{ innerHTML: '.table th{text-align:center !important;}' }] })

interface Row { id: number; title: string; slug: string; price: number; currency: string; orders: number; commission: number }
const siteUrl = useRuntimeConfig().public.siteUrl as string
const books = ref<Row[]>([])
const affiliateId = ref('')
const loading = ref(true)
const error = ref('')
const copiedId = ref<number | null>(null)

onMounted(async () => {
  try {
    const res = await usePartnerFetch<{ affiliateId: string; books: Row[] }>('/api/affiliate/books', { redirectOn403: true })
    if (res) { books.value = res.books; affiliateId.value = res.affiliateId }
  } catch (e) { error.value = partnerErrorMessage(e) } finally { loading.value = false }
})

const link = (b: Row) => `${siteUrl}/book/${b.id}/${b.slug}?aff=${affiliateId.value}`
async function copy(b: Row) {
  try { await navigator.clipboard.writeText(link(b)); copiedId.value = b.id; setTimeout(() => (copiedId.value = null), 1500) } catch { /* blocked */ }
}
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
                  <th class="wd-25p border-bottom-0">الاسم</th>
                  <th class="wd-10p border-bottom-0">الطلبات</th>
                  <th class="wd-10p border-bottom-0">التكلفة</th>
                  <th class="wd-10p border-bottom-0">العمولة</th>
                  <th class="wd-15p border-bottom-0">رابط التسويق</th>
                </tr>
              </thead>
              <tbody>
                <tr v-if="!books.length"><td colspan="6">لا توجد كتب</td></tr>
                <tr v-for="(b, i) in books" :key="b.id">
                  <td class="number_td">{{ i + 1 }}</td>
                  <td><NuxtLink target="_blank" :to="`/book/${b.id}/${b.slug}`">{{ b.title }}</NuxtLink></td>
                  <td>{{ b.orders }}</td>
                  <td>{{ partnerMoney(b.price, b.currency) }}</td>
                  <td>{{ b.commission.toFixed(3) }} {{ b.currency }}</td>
                  <td>
                    <span style="cursor: pointer;" role="button" tabindex="0" :title="link(b)" @click="copy(b)" @keydown.enter="copy(b)">
                      <i class="fa" :class="copiedId === b.id ? 'fa-check' : 'fa-copy'" />
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
