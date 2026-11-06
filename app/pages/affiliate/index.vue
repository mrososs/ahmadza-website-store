<script setup lang="ts">
// resources/views/affiliate/user/dashboard.blade.php — stats tiles + latest profits (+ the referral link).
import type { Database } from '~~/shared/types/database.types'

definePageMeta({ layout: 'affiliate', middleware: ['auth'], title: 'الإحصائيات' })

interface Summary {
  balance: { available: number; frozen: number; pendingWithdrawal: number; paidOut: number; currency: string }
  stats: { orders: number; earned: number; ordersToday: number; earnedToday: number }
  settings: { commissionPercent: number; freezeDays: number; minWithdrawal: number; testMode: boolean }
}
const client = useSupabaseClient<Database>()
const { info } = useSessionInfo()
const siteUrl = useRuntimeConfig().public.siteUrl as string

const summary = ref<Summary | null>(null)
const recent = ref<{ id: string; amount: number; currency: string; available_at: string; created_at: string; is_test: boolean }[]>([])
const loading = ref(true)
const error = ref('')
const copied = ref(false)

const referral = computed(() => (info.value ? `${siteUrl}/?aff=${info.value.id}` : ''))

onMounted(async () => {
  try {
    summary.value = await usePartnerFetch<Summary>('/api/affiliate/summary', { redirectOn403: true })
    const { data } = await client.from('affiliate_commissions')
      .select('id,amount,currency,available_at,created_at,is_test').order('created_at', { ascending: false }).limit(5)
    recent.value = (data ?? []).map((r) => ({ ...r, amount: Number(r.amount) }))
  } catch (e) {
    error.value = partnerErrorMessage(e)
  } finally { loading.value = false }
})

async function copy() {
  try { await navigator.clipboard.writeText(referral.value); copied.value = true; setTimeout(() => (copied.value = false), 1500) } catch { /* clipboard blocked */ }
}
</script>

<template>
  <div>
    <div v-if="error" class="alert alert-danger" role="alert">{{ error }}</div>
    <div v-else-if="loading" class="text-center p-5" role="status"><i class="fa fa-spinner fa-spin" /> جاري التحميل…</div>
    <template v-else-if="summary">
      <div v-if="summary.settings.testMode" class="alert alert-warning" role="status">
        وضع التطوير المحلي: العمولات الناتجة عن مدفوعات تجريبية معلّمة بـ «تجريبي» ولا تمثّل أموالاً حقيقية.
      </div>
      <div class="row mb-30">
        <div class="col-md-4">
          <div class="card card-statistics h-100">
            <div class="card-body">
              <div class="clearfix">
                <div class="float-right"><span class="text-success"><i class="fa fa-shopping-cart highlight-icon" aria-hidden="true" /></span></div>
                <div class="float-left text-left">
                  <p class="card-text text-dark"><NuxtLink to="/affiliate/profit"><i class="fa fa-external-link" /> الطلبات</NuxtLink></p>
                  <h4>{{ summary.stats.orders }}</h4>
                </div>
              </div>
              <p class="text-muted pt-3 mb-0 mt-2 border-top"><i class="fa fa-bookmark-o mr-1" aria-hidden="true" /> اليوم : {{ summary.stats.ordersToday }}</p>
            </div>
          </div>
        </div>
        <div class="col-md-4">
          <div class="card card-statistics h-100">
            <div class="card-body">
              <div class="clearfix">
                <div class="float-right"><span class="text-success"><i class="fa fa-dollar highlight-icon" aria-hidden="true" /></span></div>
                <div class="float-left text-left">
                  <p class="card-text text-dark"><NuxtLink to="/affiliate/profit"><i class="fa fa-external-link" /> الأرباح</NuxtLink></p>
                  <h4>{{ summary.stats.earned.toFixed(2) }}</h4>
                </div>
              </div>
              <p class="text-muted pt-3 mb-0 mt-2 border-top"><i class="fa fa-bookmark-o mr-1" aria-hidden="true" /> اليوم : {{ summary.stats.earnedToday.toFixed(2) }}</p>
            </div>
          </div>
        </div>
        <div class="col-md-4">
          <div class="card card-statistics h-100">
            <div class="card-body">
              <div class="clearfix">
                <div class="float-right"><span class="text-success"><i class="fa fa-dollar highlight-icon" aria-hidden="true" /></span></div>
                <div class="float-left text-left">
                  <p class="card-text text-dark"><NuxtLink to="/affiliate/withdraw"><i class="fa fa-external-link" /> الرصيد</NuxtLink></p>
                  <h4>{{ summary.balance.available.toFixed(2) }} {{ summary.balance.currency }}</h4>
                </div>
              </div>
              <p class="text-muted pt-3 mb-0 mt-2 border-top"><i class="fa fa-bookmark-o mr-1" aria-hidden="true" /> المتاح : {{ summary.balance.available.toFixed(2) }} — قيد الانتظار : {{ summary.balance.frozen.toFixed(2) }}</p>
            </div>
          </div>
        </div>
      </div>

      <div class="row mb-30">
        <div class="col-12">
          <div class="card card-statistics">
            <div class="card-body p-2">
              <h5 class="card-title m-0 p-0 text-center" style="border-bottom: 0;">رابط التسويق الخاص بك</h5>
              <div class="input-group mt-2">
                <input class="form-control" readonly :value="referral" dir="ltr" aria-label="رابط التسويق">
                <div class="input-group-append"><button type="button" class="btn btn-primary" @click="copy"><i class="fa fa-copy" /> {{ copied ? 'تم النسخ' : 'نسخ' }}</button></div>
              </div>
              <small class="text-muted">نسبة العمولة {{ summary.settings.commissionPercent }}% — تُفك الحماية بعد {{ summary.settings.freezeDays }} يوماً (قيم قابلة للضبط من الإدارة).</small>
            </div>
          </div>
        </div>
      </div>

      <div class="row">
        <div class="col-12">
          <div class="card card-statistics">
            <div class="card-body p-2"><h5 class="card-title m-0 p-0 text-center" style="border-bottom: 0;">أخر الأرباح</h5></div>
            <div class="table-responsive">
              <table class="table table-bordered m-0">
                <thead>
                  <tr><th>#</th><th>الحالة</th><th>صافى الربح</th><th>تاريخ فك الحظر</th><th>تاريخ الطلب</th></tr>
                </thead>
                <tbody>
                  <tr v-if="!recent.length"><td colspan="5" class="text-center">لا توجد أرباح بعد</td></tr>
                  <tr v-for="(r, i) in recent" :key="r.id">
                    <td>{{ i + 1 }}</td>
                    <td>
                      <span v-if="partnerIsAvailable(r.available_at)" class="badge badge-success">متاح</span>
                      <span v-else class="badge badge-warning">قيد الانتظار</span>
                      <span v-if="r.is_test" class="badge badge-secondary">تجريبي</span>
                    </td>
                    <td>{{ partnerMoney(r.amount, r.currency) }}</td>
                    <td>{{ partnerDate(r.available_at) }}</td>
                    <td>{{ partnerDate(r.created_at) }}</td>
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
