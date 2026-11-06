<script setup lang="ts">
// DEVELOPMENT PAYMENT SIMULATOR. No real payment is made; the server (POST /api/checkout/simulate/:reference) refuses it
// in production / when disabled. The amount shown is read from the payment row; nothing from this page is trusted.
definePageMeta({ middleware: 'auth' })
const route = useRoute()
const client = useSupabaseClient()
const reference = String(route.params.reference)
const busy = ref(false)
const failure = ref('')

const { data: pay, status } = await useAsyncData(`pay-${reference}`, async () => {
  const { data } = await client.from('payments').select('status,amount,currency,mode,provider').eq('reference', reference).maybeSingle()
  return data
}, { server: false })

async function run(outcome: 'success' | 'failure') {
  busy.value = true; failure.value = ''
  try {
    const r = await $fetch<{ status: string; orderNo: number | null }>(`/api/checkout/simulate/${reference}`, { method: 'POST', body: { outcome } })
    await navigateTo({ path: '/checkout/return', query: { reference } })
    return r
  } catch (e) {
    failure.value = (e as { data?: { message?: string } }).data?.message || 'تعذر تنفيذ المحاكاة'
  } finally { busy.value = false }
}
</script>

<template>
  <div>
    <PageHeading title="الدفع" />
    <div class="alert alert-danger text-center" role="alert" style="font-size: 18px; border: 3px dashed #cb2132">
      <strong>بيئة تجريبية — لا يتم أي دفع حقيقي</strong><br>
      <strong dir="ltr">DEVELOPMENT SIMULATION — NO REAL PAYMENT IS TAKEN</strong>
    </div>
    <div class="wp_form">
      <div v-if="(status === 'pending' || status === 'idle')" class="text-center" role="status"><i class="fa fa-spinner fa-spin" /> جاري التحميل…</div>
      <div v-else-if="!pay || pay.provider !== 'dev_simulator'" class="alert alert-warning" role="alert">عملية الدفع غير موجودة.</div>
      <template v-else>
        <p>المبلغ: <strong>{{ Number(pay.amount).toFixed(2) }} {{ pay.currency }}</strong> — الحالة: {{ pay.status }}</p>
        <div v-if="failure" class="alert alert-danger" role="alert">{{ failure }}</div>
        <template v-if="pay.status === 'pending'">
          <button type="button" class="wp_btn btn-block mb-2" :disabled="busy" @click="run('success')">Simulate success — محاكاة نجاح الدفع</button>
          <button type="button" class="btn btn-danger btn-block" :disabled="busy" @click="run('failure')">Simulate failure — محاكاة فشل الدفع</button>
        </template>
        <NuxtLink v-else :to="{ path: '/checkout/return', query: { reference } }" class="wp_btn btn-block">متابعة</NuxtLink>
      </template>
    </div>
  </div>
</template>
