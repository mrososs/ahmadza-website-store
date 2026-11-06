<script setup lang="ts">
// Port of admin/user/details.blade.php (ADM-03): profile, orders and library of a customer (read-only).
definePageMeta({ layout: 'admin', middleware: ['admin'] })
const id = String(useRoute().params.id)

interface Detail {
  id: string; display_name: string; email: string | null; email_confirmed: boolean; last_sign_in_at: string | null; phone: string | null; country: string | null
  status: string; is_affiliate: boolean; created_at: string; deleted_at: string | null
  orders: { id: string; order_no: number; status: string; mode: string; total_amount: number; currency: string; created_at: string }[]
  entitlements: { id: number; book_id: number; is_test: boolean; granted_at: string; revoked_at: string | null; books: { title: string } | null }[]
}
const { data: u, error, refresh } = await useFetch<Detail>(`/api/admin/users/${id}`, { server: false, key: `admin-user-${id}` })
useAdminTitle(() => (u.value ? `الملف الشخصى - ${u.value.display_name}` : 'الملف الشخصى'))
const STATUS: Record<string, string> = { active: 'مفعل', review: 'تحت المراجعة', banned: 'محظور' }
</script>

<template>
  <div>
    <div v-if="error" class="alert alert-danger" role="alert">{{ adminErrorMessage(error) }} <a href="#" @click.prevent="refresh()">إعادة المحاولة</a></div>
    <div v-else-if="!u" class="text-center p-5" role="status"><i class="fa fa-spinner fa-spin" /> جاري التحميل…</div>
    <div v-else class="row">
      <div class="col-lg-4 mb-30">
        <div class="card card-statistics h-100">
          <div class="card-body">
            <table class="table table-bordered m-0">
              <tbody>
                <tr><td>الاسم</td><td>{{ u.display_name }}</td></tr>
                <tr><td>البريد الالكترونى</td><td dir="ltr">{{ u.email }} <span v-if="!u.email_confirmed" class="badge badge-warning">غير موثق</span></td></tr>
                <tr><td>الهاتف</td><td dir="ltr">{{ u.phone || '-' }}</td></tr>
                <tr><td>الدولة</td><td>{{ u.country || '-' }}</td></tr>
                <tr><td>الحالة</td><td>{{ STATUS[u.status] ?? u.status }} <span v-if="u.deleted_at" class="badge badge-danger">محذوف</span></td></tr>
                <tr><td>النوع</td><td>{{ u.is_affiliate ? 'مسوق' : 'عميل' }}</td></tr>
                <tr><td>تاريخ التسجيل</td><td>{{ fmtDate(u.created_at) }}</td></tr>
                <tr><td>آخر دخول</td><td>{{ fmtDateTime(u.last_sign_in_at) || '-' }}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <div class="col-lg-8 mb-30">
        <div class="card card-statistics mb-30">
          <div class="card-body p-2"><h5 class="card-title m-0 p-0 text-center" style="border-bottom: 0">الفواتير</h5></div>
          <div class="table-responsive">
            <table class="table table-bordered m-0">
              <thead><tr><th>الفاتورة</th><th>الحالة</th><th>التكلفة</th><th>التاريخ</th></tr></thead>
              <tbody>
                <tr v-if="!u.orders.length"><td colspan="4" class="text-center">لا توجد فواتير</td></tr>
                <tr v-for="o in u.orders" :key="o.id">
                  <td><NuxtLink :to="`/admin/invoice/${o.order_no}`">#{{ String(o.order_no).padStart(6, '0') }}</NuxtLink></td>
                  <td>{{ o.status }} <span v-if="o.mode === 'test'" class="badge badge-secondary">تجريبي</span></td>
                  <td>{{ Number(o.total_amount).toFixed(2) }} {{ o.currency }}</td>
                  <td>{{ fmtDate(o.created_at) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <div class="card card-statistics">
          <div class="card-body p-2"><h5 class="card-title m-0 p-0 text-center" style="border-bottom: 0">المكتبة</h5></div>
          <div class="table-responsive">
            <table class="table table-bordered m-0">
              <thead><tr><th>الكتاب</th><th>تاريخ المنح</th><th>ملاحظات</th></tr></thead>
              <tbody>
                <tr v-if="!u.entitlements.length"><td colspan="3" class="text-center">لا توجد كتب</td></tr>
                <tr v-for="e in u.entitlements" :key="e.id">
                  <td><NuxtLink :to="`/admin/books/${e.book_id}/media`">{{ e.books?.title ?? e.book_id }}</NuxtLink></td>
                  <td>{{ fmtDate(e.granted_at) }}</td>
                  <td><span v-if="e.is_test" class="badge badge-secondary">تجريبي</span> <span v-if="e.revoked_at" class="badge badge-danger">ملغي</span></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
