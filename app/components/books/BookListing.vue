<script setup lang="ts">
// Port of resources/views/front/home.blade.php (home + search share it). Filter/sort/page state lives in the URL.
import { listBooks } from '~~/shared/queries/catalog'
import type { Database } from '~~/shared/types/database.types'

const route = useRoute()
const router = useRouter()
const client = useSupabaseClient<Database>()
const { data: shell } = await useShell()

const q = computed(() => ({
  page: Math.max(1, Number(route.query.page) || 1),
  search: typeof route.query.search === 'string' ? route.query.search : '',
  categoryId: Number(route.query.category) || undefined,
  order: route.query.order === 'view' ? ('view' as const) : ('newest' as const),
  hideFree: route.query.hideFree === '1',
}))

const { data, status, error, refresh } = await useAsyncData(
  () => `books:${JSON.stringify(q.value)}`,
  () => listBooks(client, q.value),
  { watch: [q] },
)

const order = ref<string>(q.value.order)
watch(q, (v) => { order.value = v.order })
const sortOptions = [
  { value: 'newest', label: 'الأحدث' },
  { value: 'view', label: 'الأكثر زيارة' },
]
function applySort() {
  router.push({ path: route.path, query: { ...route.query, order: order.value === 'newest' ? undefined : order.value, page: undefined } })
}
const freeToggle = computed(() => ({
  path: route.path,
  query: { ...route.query, hideFree: q.value.hideFree ? undefined : '1', page: undefined },
}))
</script>

<template>
  <section class="wp_home">
    <div class="search_sec">
      <form role="search" @submit.prevent="applySort">
        <div class="row">
          <div class="col-md-9 col-sm-8">
            <SelectPicker v-model="order" name="order" title="الترتيب حسب" :options="sortOptions" />
          </div>
          <div class="col-md-3 col-sm-4">
            <button class="btn-block wp_btn" type="submit">عرض النتيجة</button>
          </div>
        </div>
      </form>
    </div>
    <div class="row">
      <div v-if="shell?.settings?.show_free_book_button" class="col-12">
        <div class="search_sec appear_disappear_sec">
          <NuxtLink :to="freeToggle">
            <i class="fa" :class="q.hideFree ? 'fa-eye' : 'fa-eye-slash'" />
            {{ q.hideFree ? 'إظهار الكتب المجانية' : 'إخفاء الكتب المجانية' }}
          </NuxtLink>
        </div>
      </div>

      <div v-if="error" class="col-12"><div class="alert alert-danger" role="alert">تعذر تحميل الكتب. <a href="#" @click.prevent="refresh()">إعادة المحاولة</a></div></div>
      <div v-else-if="status === 'pending' && !data" class="col-12 text-center p-5" role="status"><i class="fa fa-spinner fa-spin" /> جاري التحميل…</div>
      <div v-else-if="data && !data.items.length" class="col-12"><div class="alert alert-info" role="status">لا توجد كتب مطابقة.</div></div>
      <template v-else-if="data">
        <BookCard v-for="b in data.items" :key="b.id" :book="b" variant="shop" />
        <AppPagination :page="data.page" :page-count="data.pageCount" />
      </template>
    </div>
  </section>
</template>
