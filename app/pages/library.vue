<script setup lang="ts">
// Port of resources/views/front/cart/lib.blade.php. Personalised: loaded client-side only, never SSR-cached.
import { listLibrary } from '~~/shared/queries/commerce'
import type { Database } from '~~/shared/types/database.types'

definePageMeta({ middleware: 'auth' })
const client = useSupabaseClient<Database>()
const route = useRoute()
const cart = useCartStore()
const { data, status, error, refresh } = await useAsyncData('library', () => listLibrary(client), { server: false, default: () => [] })
const justBought = computed(() => route.query.purchased === '1')
onMounted(() => { if (justBought.value) cart.clear() })
</script>

<template>
  <div>
    <PageHeading title="المكتبة" />
    <section class="wp_favourite">
      <div class="row">
        <div v-if="justBought" class="col-12">
          <div class="alert alert-success alert-block" role="status">
            تمت عملية الشراء بنجاح، وتمت إضافة مشترياتك إلى
            <NuxtLink to="/library">المكتبة</NuxtLink>
            الخاصة بك
          </div>
        </div>
        <div v-if="error" class="col-12"><div class="alert alert-danger" role="alert">تعذر تحميل المكتبة. <a href="#" @click.prevent="refresh()">إعادة المحاولة</a></div></div>
        <div v-else-if="(status === 'pending' || status === 'idle')" class="col-12 text-center p-5" role="status"><i class="fa fa-spinner fa-spin" /> جاري التحميل…</div>
        <div v-else-if="!data.length" class="col-12"><div class="alert alert-info" role="status">لا توجد كتب في مكتبتك بعد. <NuxtLink to="/">تصفح الكتب</NuxtLink></div></div>
        <LibraryBookCard v-for="e in data" :key="e.entitlementId" :book="e.book" :is-test="e.isTest" />
      </div>
    </section>
  </div>
</template>
