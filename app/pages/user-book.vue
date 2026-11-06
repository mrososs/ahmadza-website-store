<script setup lang="ts">
// resources/views/front/user-book.blade.php — my submissions + statistics of the books created from approved ones.
// Deviation: no "صافى الربح" (net profit) tile — the legacy system had no contributor settlement and none is invented;
// "التنزيلات" is omitted (no per-file download counter exists in the new model). Gross sales are shown instead.
import { CONTRIBUTOR_DEAL_LABEL, CONTRIBUTOR_STATUS_LABEL } from '~~/shared/constants'

definePageMeta({ middleware: ['auth'] })

interface Req { id: string; title: string; deal: 'share' | 'rent'; cost: number | null; currency: string; status: 'pending' | 'approved' | 'declined'; review_note: string | null; created_at: string; book_id: number | null }
interface Bk { id: number; title: string; slug: string; status: string; views: number; purchases: number; gross: number; created_at: string }

const { data, error, status } = await useAsyncData('user-book', () => $fetch<{ requests: Req[]; books: Bk[] }>('/api/contributor/books'), { server: false })
const bookFor = (r: Req) => data.value?.books.find((b) => b.id === r.book_id)
const BADGE = { pending: 'badge-warning', approved: 'badge-success', declined: 'badge-danger' } as const
</script>

<template>
  <div>
    <PageHeading title="كتابى" />
    <div v-if="error" class="alert alert-danger" role="alert">{{ partnerErrorMessage(error) }}</div>
    <div v-else-if="(status === 'pending' || status === 'idle') && !data" class="text-center p-5" role="status"><i class="fa fa-spinner fa-spin" /> جاري التحميل…</div>
    <div v-else-if="data && !data.requests.length" class="alert alert-info" role="status">
      لم ترسل أي طلب بعد. <NuxtLink to="/request-book">طلب إضافة كتاب</NuxtLink>
    </div>
    <section v-else-if="data" class="userbook_sec">
      <div id="accordionuserbook" class="accordion">
        <div v-for="(r, i) in data.requests" :key="r.id" class="card">
          <div class="card-header">
            <button class="btn btn-block" type="button" data-toggle="collapse" :data-target="`#collapse${i}`" :aria-expanded="i === 0">
              <img src="/assets/images/default-cover.webp" :alt="r.title" :title="r.title" class="img-fluid">
              <span>{{ r.title }}</span>
              <span class="badge" :class="BADGE[r.status]">{{ CONTRIBUTOR_STATUS_LABEL[r.status] }}</span>
              <i class="fa fa-plus" />
            </button>
          </div>
          <div :id="`collapse${i}`" class="collapse" :class="{ show: i === 0 }" data-parent="#accordionuserbook">
            <div class="card-body">
              <div class="row">
                <div v-if="bookFor(r)?.status === 'published'" class="col-12">
                  <NuxtLink class="book_link" :to="`/book/${bookFor(r)!.id}/${bookFor(r)!.slug}`">صفحة الكتاب</NuxtLink>
                </div>
                <div class="col-lg-4 col-md-6"><div class="block"><h3>تاريخ الإنشاء</h3><p>{{ partnerDate(r.created_at) }}</p></div></div>
                <div class="col-lg-4 col-md-6"><div class="block"><h3>نوع الإتفاقية</h3><p>{{ CONTRIBUTOR_DEAL_LABEL[r.deal] }}</p></div></div>
                <div class="col-lg-4 col-md-6"><div class="block"><h3>الحالة</h3><p>{{ CONTRIBUTOR_STATUS_LABEL[r.status] }}</p></div></div>
                <template v-if="bookFor(r)">
                  <div class="col-lg-4 col-md-6"><div class="block"><h3>الزيارات</h3><p>{{ bookFor(r)!.views }}</p></div></div>
                  <div class="col-lg-4 col-md-6"><div class="block"><h3>الشراء</h3><p>{{ bookFor(r)!.purchases }}</p></div></div>
                  <div class="col-lg-4 col-md-6"><div class="block"><h3>إجمالي المبيعات</h3><p>{{ bookFor(r)!.gross.toFixed(2) }}$</p></div></div>
                </template>
                <div v-if="r.review_note" class="col-12"><div class="block"><h3>ملاحظة الإدارة</h3><p>{{ r.review_note }}</p></div></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
