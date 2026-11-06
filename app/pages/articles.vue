<script setup lang="ts">
useCanonical('/articles')
// Port of resources/views/front/article.blade.php (blog list).
import { searchArticles } from '~~/shared/queries/storefront'
import type { Database } from '~~/shared/types/database.types'

const client = useSupabaseClient<Database>()
const route = useRoute()
const router = useRouter()
const { publicUrl } = useMediaUrl()

const q = computed(() => ({
  page: Math.max(1, Number(route.query.page) || 1),
  keyword: typeof route.query.keyword === 'string' ? route.query.keyword : '',
  order: (['asc', 'view'].includes(route.query.order as string) ? route.query.order : 'desc') as 'desc' | 'asc' | 'view',
}))
const { data, error } = await useAsyncData(() => `articles:${JSON.stringify(q.value)}`, () => searchArticles(client, q.value), { watch: [q] })

const keyword = ref(q.value.keyword)
const order = ref<string>(q.value.order)
const options = [{ value: 'desc', label: 'الأحدث' }, { value: 'asc', label: 'الأقدم' }, { value: 'view', label: 'الأكثر زيارة' }]
function apply() {
  router.push({ path: '/articles', query: { keyword: keyword.value.trim() || undefined, order: order.value === 'desc' ? undefined : order.value } })
}
</script>

<template>
  <div>
    <PageHeading title="المدونة" />
    <section class="wp_article">
      <div class="search_sec">
        <form role="search" @submit.prevent="apply">
          <div class="row">
            <div class="col-md-4 col-sm-6"><input v-model="keyword" name="keyword" class="form-control" placeholder="أبحث عن مقال..." aria-label="بحث"></div>
            <div class="col-md-4 col-sm-6"><SelectPicker v-model="order" name="order" title="الترتيب حسب" :options="options" /></div>
            <div class="col-md-4 col-sm-12"><button class="btn-block wp_btn" type="submit">عرض النتيجة</button></div>
          </div>
        </form>
      </div>
      <div class="row">
        <div v-if="error" class="col-12"><div class="alert alert-danger" role="alert">تعذر تحميل المقالات.</div></div>
        <div v-else-if="data && !data.items.length" class="col-12"><div class="alert alert-info">لا توجد مقالات.</div></div>
        <template v-else-if="data">
          <div class="col-12">
            <NuxtLink v-for="a in data.items" :key="a.id" :to="`/post/${a.id}`" class="item article_block">
              <div class="row">
                <div class="col-lg-3 col-sm-4 col-12">
                  <div class="img-block"><img class="img-fluid lazyload" loading="lazy" :src="publicUrl(a.poster_path)" :title="a.title" :alt="a.title"></div>
                </div>
                <div class="col-lg-9 col-sm-8 col-12">
                  <p class="title">{{ a.title }}</p>
                  <p class="pref">{{ a.excerpt }}</p>
                  <span class="icon view"><i class="fa fa-eye" /> {{ a.view_count }}</span>
                </div>
              </div>
            </NuxtLink>
          </div>
          <AppPagination :page="data.page" :page-count="data.pageCount" />
        </template>
      </div>
    </section>
  </div>
</template>
