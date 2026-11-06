<script setup lang="ts">
// Browser return from the payment page. Only the DATABASE decides the outcome (payments/orders rows, readable by the owner via RLS);
// query-string values from a gateway are never trusted.
definePageMeta({ middleware: 'auth' })
const route = useRoute()
const client = useSupabaseClient()
const reference = typeof route.query.reference === 'string' ? route.query.reference : ''
const message = ref('')
const failed = ref(false)

onMounted(async () => {
  for (let i = 0; i < 6; i++) { // webhook may land a moment after the browser
    const { data: pay } = await client.from('payments').select('status,order_id').eq('reference', reference).maybeSingle()
    if (!pay) { failed.value = true; message.value = 'عملية الدفع غير موجودة'; return }
    if (pay.status === 'succeeded' && pay.order_id) {
      const { data: order } = await client.from('orders').select('order_no').eq('id', pay.order_id).maybeSingle()
      return navigateTo({ path: `/invoice/${order?.order_no}`, query: { purchased: '1' } }, { replace: true })
    }
    if (['failed', 'cancelled', 'expired'].includes(pay.status)) { failed.value = true; message.value = 'لم تكتمل عملية الدفع، لم يتم خصم أي مبلغ ولم تُضف أي كتب.'; return }
    await new Promise((r) => setTimeout(r, 1000))
  }
  message.value = 'ما زلنا ننتظر تأكيد الدفع. يمكنك تحديث هذه الصفحة بعد لحظات.'
})
</script>

<template>
  <div>
    <PageHeading title="حالة الدفع" />
    <div class="wp_form text-center">
      <p v-if="!message" role="status"><i class="fa fa-spinner fa-spin" /> جاري التحقق من الدفع…</p>
      <div v-else class="alert" :class="failed ? 'alert-danger' : 'alert-info'" role="status">{{ message }}</div>
      <NuxtLink v-if="failed" to="/cart" class="wp_btn">العودة إلى السلة</NuxtLink>
    </div>
  </div>
</template>
