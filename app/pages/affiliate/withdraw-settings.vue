<script setup lang="ts">
// resources/views/affiliate/user/withdraw_type.blade.php — PayPal and bank-transfer payout settings.
// Reads use RLS (owner only); writes go through PUT /api/affiliate/payout-methods (validated server-side).
import type { Database } from '~~/shared/types/database.types'

definePageMeta({ layout: 'affiliate', middleware: ['auth'], title: 'إعدادت السحب' })

const client = useSupabaseClient<Database>()
const statusOptions = [{ value: '0', label: 'غير مفعلة' }, { value: '1', label: 'مفعلة' }]

const paypal = reactive({ email: '', status: '1' })
const bank = reactive({ iban: '', account_number: '', name: '', bank_name: '', status: '1' })
const msg = reactive<{ paypal: string; bank: string; paypalErr: string; bankErr: string }>({ paypal: '', bank: '', paypalErr: '', bankErr: '' })
const loading = ref(true)

onMounted(async () => {
  const { data } = await client.from('payout_methods').select('kind,details,is_active')
  for (const m of data ?? []) {
    const d = (m.details ?? {}) as Record<string, string>
    if (m.kind === 'paypal') { paypal.email = d.email ?? ''; paypal.status = m.is_active ? '1' : '0' }
    if (m.kind === 'bank_transfer') { Object.assign(bank, { iban: d.iban ?? '', account_number: d.account_number ?? '', name: d.name ?? '', bank_name: d.bank_name ?? '', status: m.is_active ? '1' : '0' }) }
  }
  loading.value = false
})

async function save(kind: 'paypal' | 'bank') {
  const body = kind === 'paypal'
    ? { kind: 'paypal', email: paypal.email, is_active: paypal.status === '1' }
    : { kind: 'bank_transfer', iban: bank.iban, account_number: bank.account_number, name: bank.name, bank_name: bank.bank_name, is_active: bank.status === '1' }
  msg[kind] = ''; msg[`${kind}Err`] = ''
  try {
    await $fetch('/api/affiliate/payout-methods', { method: 'PUT', body })
    msg[kind] = 'تم الحفظ'
  } catch (e) { msg[`${kind}Err`] = partnerErrorMessage(e) }
}
</script>

<template>
  <div class="withdraw_typ">
    <div v-if="loading" class="text-center p-4" role="status"><i class="fa fa-spinner fa-spin" /> جاري التحميل…</div>
    <template v-else>
      <div class="card mt-3">
        <div class="card-header">1.باى بال</div>
        <div class="card-body">
          <form @submit.prevent="save('paypal')">
            <div class="row">
              <div class="col-12">
                <div class="form-group">
                  <label for="pp-email">البريد الإلكترونى</label>
                  <input id="pp-email" v-model="paypal.email" name="email" class="form-control" placeholder="البريد الإلكترونى" dir="ltr">
                </div>
              </div>
              <div class="col-12">
                <div class="form-group">
                  <label>الحالة</label>
                  <SelectPicker v-model="paypal.status" name="status" title="أختر الحالة" :options="statusOptions" />
                </div>
              </div>
              <div class="col-12 text-center">
                <div v-if="msg.paypal" class="alert alert-success" role="status">{{ msg.paypal }}</div>
                <div v-if="msg.paypalErr" class="alert alert-danger" role="alert">{{ msg.paypalErr }}</div>
                <button class="btn btn-success" type="submit">حفظ</button>
              </div>
            </div>
          </form>
        </div>
      </div>
      <div class="card mt-3">
        <div class="card-header">2.تحويل بنكى</div>
        <div class="card-body">
          <form @submit.prevent="save('bank')">
            <div class="row">
              <div class="col-12"><div class="form-group"><label for="b-iban">رقم الـ IBAN</label><input id="b-iban" v-model="bank.iban" name="iban" class="form-control" placeholder="رقم الـ IBAN" dir="ltr"></div></div>
              <div class="col-12"><div class="form-group"><label for="b-acc">رقم الحساب</label><input id="b-acc" v-model="bank.account_number" name="account_number" class="form-control" placeholder="رقم الحساب" dir="ltr"></div></div>
              <div class="col-12"><div class="form-group"><label for="b-name">أسم صاحب الحساب</label><input id="b-name" v-model="bank.name" name="name" class="form-control" placeholder="أسم صاحب الحساب"></div></div>
              <div class="col-12"><div class="form-group"><label for="b-bank">إسم البنك</label><input id="b-bank" v-model="bank.bank_name" name="bank_name" class="form-control" placeholder="إسم البنك"></div></div>
              <div class="col-12">
                <div class="form-group">
                  <label>الحالة</label>
                  <SelectPicker v-model="bank.status" name="status" title="أختر الحالة" :options="statusOptions" />
                </div>
              </div>
              <div class="col-12 text-center">
                <div v-if="msg.bank" class="alert alert-success" role="status">{{ msg.bank }}</div>
                <div v-if="msg.bankErr" class="alert alert-danger" role="alert">{{ msg.bankErr }}</div>
                <button class="btn btn-success" type="submit">حفظ</button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </template>
  </div>
</template>
