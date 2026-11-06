<script setup lang="ts">
useCanonical('/authors')
import { listMakers } from '~~/shared/queries/catalog'
import type { Database } from '~~/shared/types/database.types'

const client = useSupabaseClient<Database>()
const route = useRoute()
const page = computed(() => Math.max(1, Number(route.query.page) || 1))
const { publicUrl } = useMediaUrl()
const { data, error } = await useAsyncData(() => `makers:${page.value}`, () => listMakers(client, page.value), { watch: [page] })
</script>

<template>
  <div>
    <PageHeading title="المؤلفون" />
    <section class="wp_home">
      <div class="row">
        <div v-if="error" class="col-12"><div class="alert alert-danger" role="alert">تعذر تحميل القائمة.</div></div>
        <div v-else-if="data && !data.items.length" class="col-12"><div class="alert alert-info">لا يوجد مؤلفون.</div></div>
        <template v-else-if="data">
          <CardTile v-for="m in data.items" :key="m.id" :name="m.name" :to="`/maker/${m.id}`" :image="publicUrl(m.image_path, '/assets/images/avatar.webp')" />
          <AppPagination :page="data.page" :page-count="data.pageCount" />
        </template>
      </div>
    </section>
  </div>
</template>
