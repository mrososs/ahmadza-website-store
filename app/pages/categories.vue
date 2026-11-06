<script setup lang="ts">
import { listCategories } from '~~/shared/queries/catalog'
import type { Database } from '~~/shared/types/database.types'

const client = useSupabaseClient<Database>()
const route = useRoute()
const page = computed(() => Math.max(1, Number(route.query.page) || 1))
const { publicUrl } = useMediaUrl()
const { data, error } = await useAsyncData(() => `categories:${page.value}`, () => listCategories(client, page.value, 20), { watch: [page] })
</script>

<template>
  <div>
    <PageHeading title="الأقسام" />
    <section class="wp_home">
      <div class="row">
        <div v-if="error" class="col-12"><div class="alert alert-danger" role="alert">تعذر تحميل الأقسام.</div></div>
        <div v-else-if="data && !data.items.length" class="col-12"><div class="alert alert-info">لا توجد أقسام.</div></div>
        <template v-else-if="data">
          <CardTile
            v-for="c in data.items" :key="c.id" :name="c.name" :to="`/search?category=${c.id}`" :browse-to="`/search?category=${c.id}`"
            :image="publicUrl(c.image_path)"
          />
          <AppPagination :page="data.page" :page-count="data.pageCount" />
        </template>
      </div>
    </section>
  </div>
</template>
