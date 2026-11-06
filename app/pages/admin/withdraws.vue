<script setup lang="ts">
// resources/views/affiliate/admin/withdraw.blade.php — withdrawal requests; decide pending ones (paid + optional proof,
// or rejected with a message). A rejection re-credits the held amount through the append-only ledger.
definePageMeta({ layout: 'admin', middleware: ['admin'] })
useAdminTitle('طلبات سحب الأرباح')
useHead({ style: [{ innerHTML: '.table th{text-align:center !important;}' }] })

interface Row {
  id: string; affiliate_id: string; affiliateName: string; amount: number; currency: string; status: 'pending' | 'paid' | 'rejected'
  note: string | null; hasProof: boolean; requested_at: string; decided_at: string | null
  payout: { kind: string; details: Record<string, string> }[]
}
const rows = ref<Row[]>([])
const loading = ref(true)
const error = ref('')
const selected = ref<Row | null>(null)
const decision = ref('paid')
const note = ref('')
const proof = ref<File | null>(null)
const closeBtn = ref<HTMLButtonElement | null>(null)
const options = [{ value: 'paid', label: 'تم الارسال' }, { value: 'rejected', label: 'فشل (رفض)' }]

async function load() {
  try { rows.value = await $fetch<Row[]>('/api/admin/withdrawals') } catch (e) { error.value = partnerErrorMessage(e) } finally { loading.value = false }
}
onMounted(load)

function pick(r: Row) { selected.value = r; decision.value = 'paid'; note.value = ''; proof.value = null }
async function save() {
  if (!selected.value) return
  const fd = new FormData()
  fd.append('approve', decision.value === 'paid' ? 'true' : 'false')
  if (note.value) fd.append('note', note.value)
  if (proof.value && decision.value === 'paid') fd.append('attachment', proof.value)
  try {
    await $fetch(`/api/admin/withdrawals/${selected.value.id}/decision`, { method: 'POST', body: fd })
    closeBtn.value?.click()
    await load()
  } catch (e) { error.value = partnerErrorMessage(e) }
}
const payoutText = (p: Row['payout']) => p.map((m) => `${m.kind === 'paypal' ? 'PayPal' : 'Bank'}: ${Object.values(m.details).join(' / ')}`).join(' | ')
</script>

<template>
  <div class="row">
    <div class="col-12">
      <div id="update_modal" class="modal main-model">
        <div class="modal-dialog modal-dialog-centered" role="document">
          <div class="modal-content modal-content-demo">
            <form enctype="multipart/form-data" @submit.prevent="save">
              <div class="modal-header"><h6 class="modal-title text-center text-danger">تعديل الحالة</h6></div>
              <div class="modal-body">
                <p v-if="selected" dir="ltr" class="text-left"><strong>{{ selected.affiliateName }}</strong> — {{ partnerMoney(selected.amount, selected.currency) }}<br>{{ payoutText(selected.payout) || 'لا توجد بيانات سحب' }}</p>
                <div class="form-group"><label>الحالة</label><SelectPicker v-model="decision" name="status" title="أختر الحالة" :options="options" /></div>
                <div class="form-group"><label for="wd-msg">الرسالة</label><textarea id="wd-msg" v-model="note" name="message" class="form-control" placeholder="أكتب الرسالة هنا" /></div>
                <div v-if="decision === 'paid'" class="form-group">
                  <label for="wd-file">المرفق (pdf, jpg, png, webp — حتى 2 ميجا)</label>
                  <input id="wd-file" type="file" name="attachment" accept=".pdf,.jpg,.jpeg,.png,.webp" @change="proof = ($event.target as HTMLInputElement).files?.[0] ?? null">
                </div>
              </div>
              <div class="modal-footer">
                <button class="btn ripple btn-success" type="submit">حفظ</button>
                <button ref="closeBtn" class="btn ripple btn-secondary" data-dismiss="modal" type="button">أغلاق</button>
              </div>
            </form>
          </div>
        </div>
      </div>
      <div v-if="error" class="alert alert-danger" role="alert">{{ error }}</div>
      <div class="card card-statistics h-100">
        <div class="card-body">
          <div v-if="loading" class="text-center p-4" role="status"><i class="fa fa-spinner fa-spin" /> جاري التحميل…</div>
          <div v-else class="table-responsive">
            <table class="table is-striped text-center w-100 data-table">
              <thead>
                <tr>
                  <th class="wd-5p border-bottom-0">#</th>
                  <th class="wd-30p border-bottom-0">المسوق</th>
                  <th class="wd-30p border-bottom-0">المبلغ</th>
                  <th class="wd-30p border-bottom-0">الحالة</th>
                  <th class="wd-10p border-bottom-0">المرفق</th>
                  <th class="wd-10p border-bottom-0">رسالة</th>
                  <th class="wd-15p border-bottom-0">أخر تعديل</th>
                  <th class="wd-10p border-bottom-0">العمليات</th>
                </tr>
              </thead>
              <tbody>
                <tr v-if="!rows.length"><td colspan="8">لا توجد طلبات سحب</td></tr>
                <tr v-for="(r, i) in rows" :key="r.id">
                  <td class="number_td">{{ i + 1 }}</td>
                  <td><NuxtLink class="text-primary" target="_blank" :to="`/admin/affiliates/${r.affiliate_id}`">{{ r.affiliateName }}</NuxtLink></td>
                  <td>{{ partnerMoney(r.amount, r.currency) }}</td>
                  <td><span class="badge" :class="WITHDRAW_BADGE[r.status].cls">{{ WITHDRAW_BADGE[r.status].label }}</span></td>
                  <td><a v-if="r.hasProof" target="_blank" :href="`/api/affiliate/withdrawals/${r.id}/proof`"><i class="fa fa-file" /></a><template v-else>-</template></td>
                  <td>
                    <template v-if="r.note">
                      <button type="button" class="btn" data-toggle="modal" :data-target="`#message_${r.id}`"><i class="fa fa-envelope" /></button>
                      <div :id="`message_${r.id}`" class="modal"><div class="modal-dialog"><div class="modal-content"><div class="modal-body text-center">{{ r.note }}</div><div class="modal-footer"><button type="button" class="btn btn-danger" data-dismiss="modal">إغلاق</button></div></div></div></div>
                    </template>
                    <template v-else>-</template>
                  </td>
                  <td>{{ partnerDate(r.decided_at ?? r.requested_at) }}</td>
                  <td>
                    <button v-if="r.status === 'pending'" type="button" class="btn btn-sm btn-success" data-toggle="modal" data-target="#update_modal" @click="pick(r)"><i class="fa fa-edit" /> تعديل</button>
                    <template v-else>-</template>
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
