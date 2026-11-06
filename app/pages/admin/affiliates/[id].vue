<script setup lang="ts">
// resources/views/affiliate/admin/profile.blade.php — affiliate profile with commissions, withdrawals, payout details.
definePageMeta({ layout: 'admin', middleware: ['admin'] })
const heading = ref('الملف الشخصى')
useAdminTitle(heading)

const route = useRoute()
const id = String(route.params.id)
interface Detail {
  profile: { id: string; display_name: string; email: string | null; phone: string | null; status: 'active' | 'review' | 'banned'; created_at: string }
  balance: { available: number; frozen: number; pending: number; paidOut: number }
  commissions: { id: string; amount: number; currency: string; available_at: string; is_test: boolean; created_at: string; orders: { order_no: number } | null }[]
  withdrawals: { id: string; amount: number; currency: string; status: 'pending' | 'paid' | 'rejected'; note: string | null; hasProof: boolean; requested_at: string }[]
  payoutMethods: { kind: string; details: Record<string, string>; is_active: boolean }[]
}
const siteUrl = useRuntimeConfig().public.siteUrl as string
const d = ref<Detail | null>(null)
const error = ref('')
const newStatus = ref('active')
const closeBtn = ref<HTMLButtonElement | null>(null)
const statusOptions = [{ value: 'review', label: 'تحت المراجعة' }, { value: 'active', label: 'مفعل' }, { value: 'banned', label: 'محظور' }]

async function load() {
  try {
    d.value = await $fetch<Detail>(`/api/admin/affiliates/${id}`)
    newStatus.value = d.value.profile.status
    heading.value = `الملف الشخصى - ${d.value.profile.display_name}`
  } catch (e) { error.value = partnerErrorMessage(e) }
}
onMounted(load)

async function saveStatus() {
  try {
    await $fetch(`/api/admin/affiliates/${id}`, { method: 'PATCH', body: { status: newStatus.value } })
    closeBtn.value?.click()
    await load()
  } catch (e) { error.value = partnerErrorMessage(e) }
}
</script>

<template>
  <div>
    <div v-if="error" class="alert alert-danger" role="alert">{{ error }}</div>
    <div v-else-if="!d" class="text-center p-5" role="status"><i class="fa fa-spinner fa-spin" /> جاري التحميل…</div>
    <template v-else>
      <div id="update_modal" class="modal main-model">
        <div class="modal-dialog modal-dialog-centered" role="document">
          <div class="modal-content modal-content-demo">
            <form @submit.prevent="saveStatus">
              <div class="modal-header"><h6 class="modal-title text-center">تغير حالة المستخدم</h6></div>
              <div class="modal-body">
                <div class="form-group"><label>الأسم الحقيقى</label><input :value="d.profile.display_name" readonly class="form-control"></div>
                <div class="form-group"><label>الحالة</label><SelectPicker v-model="newStatus" name="status" title="أختر الحالة" :options="statusOptions" /></div>
              </div>
              <div class="modal-footer">
                <button class="btn ripple btn-success" type="submit">حفظ</button>
                <button ref="closeBtn" class="btn ripple btn-secondary" data-dismiss="modal" type="button">أغلاق</button>
              </div>
            </form>
          </div>
        </div>
      </div>

      <div class="row">
        <div class="col-12">
          <div class="main-body">
            <div class="row gutters-sm">
              <div class="col-md-4 mb-3">
                <div class="card">
                  <div class="card-body">
                    <div class="d-flex flex-column align-items-center text-center">
                      <img src="/assets/images/avatar.png" :alt="d.profile.display_name" class="rounded-circle" width="150">
                      <div class="mt-3">
                        <h4>{{ d.profile.display_name }}</h4>
                        <p class="text-secondary mb-2">
                          <span class="badge" :class="ACCOUNT_STATUS_BADGE[d.profile.status].cls" style="color: #fff">{{ ACCOUNT_STATUS_BADGE[d.profile.status].label }}</span>
                          <span class="badge badge-success">مسوق بالعمولة</span>
                        </p>
                        <p class="text-muted font-size-sm mb-2">{{ d.profile.email }}</p>
                        <p class="text-muted font-xs mb-2">{{ partnerDate(d.profile.created_at) }}</p>
                        <a class="btn btn-outline-primary" data-toggle="modal" href="#update_modal"><i class="fa fa-edit" /> تعديل الحالة</a>
                        <a class="btn btn-primary" :href="`${siteUrl}/?aff=${d.profile.id}`" target="_blank" rel="noopener"><i class="fa fa-external-link" /> رابط التسويق</a>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div class="col-md-8">
                <div class="card mb-3">
                  <div class="card-body">
                    <div class="row"><div class="col-sm-3"><h6 class="mb-0">الأسم بالكامل</h6></div><div class="col-sm-9 text-secondary">{{ d.profile.display_name }}</div></div><hr>
                    <div class="row"><div class="col-sm-3"><h6 class="mb-0">رقم الجوال</h6></div><div class="col-sm-9 text-secondary">{{ d.profile.phone || '-' }}</div></div><hr>
                    <div class="row"><div class="col-sm-3"><h6 class="mb-0">عدد الطلبات</h6></div><div class="col-sm-9 text-secondary">{{ d.commissions.length }}</div></div><hr>
                    <div class="row"><div class="col-sm-3"><h6 class="mb-0">الرصيد المتاح</h6></div><div class="col-sm-9 text-secondary">{{ partnerMoney(d.balance.available) }}</div></div><hr>
                    <div class="row"><div class="col-sm-3"><h6 class="mb-0">قيد الانتظار (محجوز)</h6></div><div class="col-sm-9 text-secondary">{{ partnerMoney(d.balance.frozen) }}</div></div><hr>
                    <div class="row"><div class="col-sm-3"><h6 class="mb-0">سحب قيد المراجعة / تم تحويله</h6></div><div class="col-sm-9 text-secondary">{{ partnerMoney(d.balance.pending) }} / {{ partnerMoney(d.balance.paidOut) }}</div></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="col-12">
          <div id="profile-accordion" class="accordion">
            <div class="card">
              <div class="card-header"><button class="button btn-block" type="button" data-toggle="collapse" data-target="#order_col1" aria-expanded="true">العمولات ({{ d.commissions.length }})</button></div>
              <div id="order_col1" class="collapse show" data-parent="#profile-accordion">
                <div class="card-body table-responsive">
                  <table class="table table-bordered text-center">
                    <thead><tr><th>#</th><th>رقم الطلب</th><th>الحالة</th><th>المبلغ</th><th>تاريخ فك الحظر</th></tr></thead>
                    <tbody>
                      <tr v-if="!d.commissions.length"><td colspan="5">لا توجد عمولات</td></tr>
                      <tr v-for="(c, i) in d.commissions" :key="c.id">
                        <td>{{ i + 1 }}</td>
                        <td>{{ c.orders?.order_no ?? '-' }}</td>
                        <td>
                          <span v-if="partnerIsAvailable(c.available_at)" class="badge badge-success">متاح</span>
                          <span v-else class="badge badge-warning">قيد الانتظار</span>
                          <span v-if="c.is_test" class="badge badge-secondary">تجريبي</span>
                        </td>
                        <td>{{ partnerMoney(c.amount, c.currency) }}</td>
                        <td>{{ partnerDate(c.available_at) }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
            <div class="card">
              <div class="card-header"><button class="button btn-block" type="button" data-toggle="collapse" data-target="#wd_col" aria-expanded="false">طلبات السحب ({{ d.withdrawals.length }})</button></div>
              <div id="wd_col" class="collapse" data-parent="#profile-accordion">
                <div class="card-body table-responsive">
                  <table class="table table-bordered text-center">
                    <thead><tr><th>#</th><th>المبلغ</th><th>الحالة</th><th>المرفق</th><th>التاريخ</th></tr></thead>
                    <tbody>
                      <tr v-if="!d.withdrawals.length"><td colspan="5">لا توجد طلبات</td></tr>
                      <tr v-for="(w, i) in d.withdrawals" :key="w.id">
                        <td>{{ i + 1 }}</td>
                        <td>{{ partnerMoney(w.amount, w.currency) }}</td>
                        <td><span class="badge" :class="WITHDRAW_BADGE[w.status].cls">{{ WITHDRAW_BADGE[w.status].label }}</span></td>
                        <td><a v-if="w.hasProof" target="_blank" :href="`/api/affiliate/withdrawals/${w.id}/proof`"><i class="fa fa-file" /></a><template v-else>-</template></td>
                        <td>{{ partnerDate(w.requested_at) }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
            <div class="card">
              <div class="card-header"><button class="button btn-block" type="button" data-toggle="collapse" data-target="#payout_col" aria-expanded="false">بيانات السحب (حساسة)</button></div>
              <div id="payout_col" class="collapse" data-parent="#profile-accordion">
                <div class="card-body">
                  <p v-if="!d.payoutMethods.length">لم يُضف المسوّق وسيلة سحب</p>
                  <div v-for="m in d.payoutMethods" :key="m.kind" class="mb-3">
                    <h6>{{ m.kind === 'paypal' ? 'باى بال' : 'تحويل بنكى' }} <span class="badge" :class="m.is_active ? 'badge-success' : 'badge-secondary'">{{ m.is_active ? 'مفعلة' : 'غير مفعلة' }}</span></h6>
                    <ul class="list-unstyled" dir="ltr"><li v-for="(v, k) in m.details" :key="k"><strong>{{ k }}:</strong> {{ v }}</li></ul>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
