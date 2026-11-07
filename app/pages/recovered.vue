<script setup lang="ts">
// The recovered catalogue under review: books found in the archive of the old site that nobody has reviewed yet. It exists only in the password-protected preview
// (the server answers 404 otherwise) and is kept visibly apart from the approved store: no purchase, no download, every unknown stated as unknown.
import type { RecoveredPreviewItem } from '~~/shared/utils/recoveredPreview'

useHead({ title: 'الكتالوج المستعاد — قيد المراجعة' })
const route = useRoute()
const router = useRouter()
const term = ref(typeof route.query.search === 'string' ? route.query.search : '')
const query = computed(() => ({
  page: Math.max(1, Number(route.query.page) || 1),
  search: typeof route.query.search === 'string' ? route.query.search : '',
}))
const { data, error, refresh } = useFetch<{ items: RecoveredPreviewItem[]; total: number; page: number; pageCount: number }>('/api/preview/recovered', {
  query, server: false, lazy: true, watch: [query],
})
const notAvailable = computed(() => (error.value as { statusCode?: number } | null)?.statusCode === 404)
function submitSearch() {
  router.push({ path: '/recovered', query: term.value.trim() ? { search: term.value.trim() } : {} })
}
</script>

<template>
  <section class="wp_home recovered-page">
    <h3 class="wp_h3">الكتالوج المستعاد — قيد المراجعة</h3>
    <div class="alert alert-warning" role="note">
      هذه كتب <strong>مستعادة من أرشيف الموقع القديم</strong> وما زالت <strong>قيد المراجعة</strong>. العناوين مأخوذة من الملفات نفسها ولم تُطابق بعد مع سجلات الكتالوج الأصلية،
      والمؤلفون والأقسام والأسعار <strong>غير محددة</strong>. لا يمكن شراء هذه الكتب أو تنزيلها في هذه المعاينة، والكتالوج التجاري المعتمد يضم الكتب المنشورة بعد المراجعة فقط.
    </div>

    <div class="search_sec">
      <form role="search" @submit.prevent="submitSearch">
        <div class="row">
          <div class="col-md-9 col-sm-8"><input v-model="term" class="form-control" type="search" maxlength="80" placeholder="ابحث في عناوين الكتب المستعادة" aria-label="ابحث في الكتب المستعادة"></div>
          <div class="col-md-3 col-sm-4"><button class="btn-block wp_btn" type="submit">بحث</button></div>
        </div>
      </form>
    </div>

    <div v-if="notAvailable" class="alert alert-info" role="status">هذه الصفحة متاحة في المعاينة المحمية فقط.</div>
    <div v-else-if="error" class="alert alert-danger" role="alert">تعذر تحميل الكتب المستعادة. <a href="#" @click.prevent="refresh()">إعادة المحاولة</a></div>
    <div v-else-if="!data" class="text-center p-5" role="status"><i class="fa fa-spinner fa-spin" /> جاري التحميل…</div>
    <template v-else-if="data">
      <p class="text-muted" role="status">{{ data.total }} كتابًا قيد المراجعة<template v-if="query.search"> مطابقًا لـ «{{ query.search }}»</template></p>
      <div v-if="!data.items.length" class="alert alert-info" role="status">لا توجد كتب مستعادة مطابقة لبحثك.</div>
      <div v-else class="row">
        <RecoveredCard v-for="b in data.items" :key="b.id" :item="b" />
      </div>
      <AppPagination v-if="data.pageCount > 1" :page="data.page" :page-count="data.pageCount" />
    </template>
  </section>
</template>
