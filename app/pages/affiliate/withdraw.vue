<script setup lang="ts">
// resources/views/affiliate/user/withdraw.blade.php — request modal + history table.
definePageMeta({ layout: 'affiliate', middleware: ['auth'], title: 'سحب الأرباح' })
useHead({ style: [{ innerHTML: '.table th{text-align:center !important;}' }] })

interface Summary { balance: { available: number; currency: string }; settings: { minWithdrawal: number } }
interface Withdrawal { id: string; amount: number; currency: string; status: 'pending' | 'paid' | 'rejected'; note: string | null; hasProof: boolean; requested_at: string; decided_at: string | null }

const summary = ref<Summary | null>(null)
const rows = ref<Withdrawal[]>([])
const loading = ref(true)
const error = ref('')
const amount = ref('')
const submitting = ref(false)
const formError = ref('')
const success = ref('')
const closeBtn = ref<HTMLButtonElement | null>(null)

async function load() {
  try {
    const [s, w] = await Promise.all([
      usePartnerFetch<Summary>('/api/affiliate/summary', { redirectOn403: true }),
      usePartnerFetch<Withdrawal[]>('/api/affiliate/withdrawals', { redirectOn403: true }),
    ])
    summary.value = s
    rows.value = w ?? []
  } catch (e) { error.value = partnerErrorMessage(e) } finally { loading.value = false }
}
onMounted(load)

async function submit() {
  formError.value = ''; success.value = ''
  const n = Number(amount.value)
  if (!Number.isFinite(n) || n <= 0) { formError.value = 'أدخل قيمة صحيحة (أرقام فقط)'; return }
  submitting.value = true
  try {
    await $fetch('/api/affiliate/withdrawals', { method: 'POST', body: { amount: n } })
    success.value = 'تم إرسال طلب السحب'
    amount.value = ''
    closeBtn.value?.click()
    await load()
  } catch (e) { formError.value = partnerErrorMessage(e) } finally { submitting.value = false }
}
</script>

<template>
  <div class="row">
    <div class="col-12 text-right mb-3">
      <div v-if="success" class="alert alert-success text-right" role="status">{{ success }}</div>
      <div id="request_withdraw_money" class="modal main-model">
        <div class="modal-dialog modal-dialog-centered" role="document">
          <div class="modal-content modal-content-demo">
            <form @submit.prevent="submit">
              <div class="modal-header">
                <h6 class="modal-title text-center w-100">
                  المتاح
                  <strong class="text-success font-xxl">{{ partnerMoney(summary?.balance.available, summary?.balance.currency) }}</strong>
                </h6>
              </div>
              <div class="modal-body">
                <div class="form-group text-left">
                  <label for="amount">
                    القيمة المطلوب سحبها
                    (<span class="text-danger">أقل مبلغ للسحب {{ summary?.settings.minWithdrawal ?? 0 }} USD</span>)
                  </label>
                  <input id="amount" v-model="amount" required inputmode="decimal" name="amount" class="form-control" placeholder="أدخل القيمة المطلوب سحبها (أرقام فقط)">
                  <div v-if="formError" class="text-danger mt-1" role="alert">{{ formError }}</div>
                </div>
              </div>
              <div class="modal-footer">
                <button class="btn ripple btn-success" type="submit" :disabled="submitting">أطلب</button>
                <button ref="closeBtn" class="btn ripple btn-secondary" data-dismiss="modal" type="button">أغلاق</button>
              </div>
            </form>
          </div>
        </div>
      </div>
      <button type="button" class="btn btn-primary" data-toggle="modal" data-target="#request_withdraw_money">
        <i class="fa fa-dollar" /> طلب سحب أموال
      </button>
    </div>
    <div class="col-12">
      <div class="card card-statistics h-100">
        <div class="card-body">
          <div v-if="error" class="alert alert-danger" role="alert">{{ error }}</div>
          <div v-else-if="loading" class="text-center p-4" role="status"><i class="fa fa-spinner fa-spin" /> جاري التحميل…</div>
          <div v-else class="table-responsive">
            <table class="table is-striped text-center w-100 data-table">
              <thead>
                <tr>
                  <th class="wd-5p border-bottom-0">#</th>
                  <th class="wd-30p border-bottom-0">المبلغ</th>
                  <th class="wd-30p border-bottom-0">الحالة</th>
                  <th class="wd-10p border-bottom-0">المرفق</th>
                  <th class="wd-10p border-bottom-0">رسالة</th>
                  <th class="wd-15p border-bottom-0">أخر تعديل</th>
                </tr>
              </thead>
              <tbody>
                <tr v-if="!rows.length"><td colspan="6">لا توجد طلبات سحب</td></tr>
                <tr v-for="(w, i) in rows" :key="w.id">
                  <td class="number_td">{{ i + 1 }}</td>
                  <td>{{ partnerMoney(w.amount, w.currency) }}</td>
                  <td><span class="badge" :class="WITHDRAW_BADGE[w.status].cls">{{ WITHDRAW_BADGE[w.status].label }}</span></td>
                  <td><a v-if="w.hasProof" target="_blank" :href="`/api/affiliate/withdrawals/${w.id}/proof`"><i class="fa fa-file" /></a><template v-else>-</template></td>
                  <td>
                    <template v-if="w.note">
                      <button type="button" class="btn" data-toggle="modal" :data-target="`#message_${w.id}`"><i class="fa fa-envelope" /></button>
                      <div :id="`message_${w.id}`" class="modal">
                        <div class="modal-dialog">
                          <div class="modal-content">
                            <div class="modal-body text-center">{{ w.note }}</div>
                            <div class="modal-footer"><button type="button" class="btn btn-danger" data-dismiss="modal">إغلاق</button></div>
                          </div>
                        </div>
                      </div>
                    </template>
                    <template v-else>-</template>
                  </td>
                  <td>{{ partnerDate(w.decided_at ?? w.requested_at) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
