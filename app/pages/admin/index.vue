<script setup lang="ts">
// Port of admin/dashboard.blade.php with real counts (ADM-04).
definePageMeta({ layout: 'admin', middleware: ['admin'] })
useAdminTitle('لوحة التحكم')

interface Dash {
  cards: Record<'users' | 'contacts' | 'books' | 'orders' | 'comments' | 'articles' | 'requests', { total: number; today: number }>
  revenueByCurrency: Record<string, number>
  latestOrders: { id: string; order_no: number; status: string; mode: string; total_amount: number; currency: string; created_at: string }[]
  latestBooks: { id: number; title: string; status: string; kind: string; created_at: string }[]
}
const { data, pending, error, refresh } = useFetch<Dash>('/api/admin/dashboard', { server: false })
const revenue = computed(() => Object.entries(data.value?.revenueByCurrency ?? {}).map(([c, v]) => `${v.toFixed(2)} ${c}`).join(' + ') || '0.00')
const orderStatus: Record<string, { label: string; cls: string }> = {
  paid: { label: 'نجح', cls: 'badge-success' }, failed: { label: 'فشل', cls: 'badge-danger' }, refunded: { label: 'مسترد', cls: 'badge-warning' },
}
</script>

<template>
  <div>
    <div v-if="error" class="alert alert-danger" role="alert">{{ adminErrorMessage(error) }} <a href="#" @click.prevent="refresh()">إعادة المحاولة</a></div>
    <div v-else-if="pending && !data" class="text-center p-5" role="status"><i class="fa fa-spinner fa-spin" /> جاري التحميل…</div>
    <template v-else-if="data">
      <div class="row">
        <AdminStatCard color="danger" icon="fa-bar-chart-o" label="المستخدمين" to="/admin/users" :total="data.cards.users.total" :today="data.cards.users.today" subicon="fa-clock-o" />
        <AdminStatCard color="primary" icon="fa-envelope" label="الرسائل" to="/admin/contacts" :total="data.cards.contacts.total" :today="data.cards.contacts.today" subicon="fa-clock-o" />
        <AdminStatCard color="warning" icon="fa-book" label="الكتب" to="/admin/stats/books" :total="data.cards.books.total" :today="data.cards.books.today" />
        <AdminStatCard color="success" icon="fa-shopping-cart" label="الطلبات" to="/admin/orders" :total="data.cards.orders.total" :today="data.cards.orders.today" />
        <AdminStatCard color="danger" icon="fa-comment" label="التعليقات" to="/admin/comments" :total="data.cards.comments.total" :today="data.cards.comments.today" />
        <AdminStatCard color="primary" icon="fa-indent" label="المدونة" to="/admin/articles" :total="data.cards.articles.total" :today="data.cards.articles.today" />
        <AdminStatCard color="warning" icon="fa-user" label="طلب اضافة كتاب" to="/admin/request-books" :total="data.cards.requests.total" :today="data.cards.requests.today" />
        <AdminStatCard color="success" icon="fa-dollar" label="الأرباح (حية فقط)" to="/admin/stats/revenue" :total="revenue" />
      </div>
      <div class="row">
        <div class="col-lg-6 mb-30">
          <div class="card card-statistics">
            <div class="card-body p-2"><h5 class="card-title m-0 p-0 text-center" style="border-bottom: 0">طلبات</h5></div>
            <div class="table-responsive">
              <table class="table table-bordered m-0">
                <thead><tr><th>#</th><th>الفاتورة</th><th>الحالة</th><th>التكلفة</th><th>التاريخ</th></tr></thead>
                <tbody>
                  <tr v-if="!data.latestOrders.length"><td colspan="5" class="text-center">لا توجد طلبات</td></tr>
                  <tr v-for="(o, i) in data.latestOrders" :key="o.id">
                    <td>{{ i + 1 }}</td>
                    <td><NuxtLink :to="`/admin/invoice/${o.order_no}`">#{{ String(o.order_no).padStart(6, '0') }}</NuxtLink></td>
                    <td>
                      <span class="badge" :class="orderStatus[o.status]?.cls">{{ orderStatus[o.status]?.label ?? o.status }}</span>
                      <span v-if="o.mode === 'test'" class="badge badge-secondary">تجريبي</span>
                    </td>
                    <td>{{ Number(o.total_amount).toFixed(2) }} {{ o.currency }}</td>
                    <td>{{ fmtDate(o.created_at) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
        <div class="col-lg-6 mb-30">
          <div class="card card-statistics">
            <div class="card-body p-2"><h5 class="card-title m-0 p-0 text-center" style="border-bottom: 0">كتب</h5></div>
            <div class="table-responsive">
              <table class="table table-bordered m-0">
                <thead><tr><th>#</th><th>اسم الكتاب</th><th>الحالة</th><th>النوع</th><th>التاريخ</th></tr></thead>
                <tbody>
                  <tr v-if="!data.latestBooks.length"><td colspan="5" class="text-center">لا توجد كتب</td></tr>
                  <tr v-for="(b, i) in data.latestBooks" :key="b.id">
                    <td>{{ i + 1 }}</td>
                    <td><NuxtLink :to="`/admin/books/${b.id}/media`">{{ b.title }}</NuxtLink></td>
                    <td><span class="badge" :class="STATUS_BADGE[b.status]?.cls">{{ STATUS_BADGE[b.status]?.label }}</span></td>
                    <td>{{ b.kind === 'free' ? 'مجانى' : 'مدفوع' }}</td>
                    <td>{{ fmtDate(b.created_at) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
