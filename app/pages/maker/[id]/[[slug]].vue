<script setup lang="ts">
// Port of resources/views/front/maker.blade.php. The slug segment is cosmetic; the id is canonical.
import { getMaker, listBooks } from '~~/shared/queries/catalog'
import { MAKER_KIND_LABEL } from '~~/shared/constants'
import type { Database } from '~~/shared/types/database.types'

const client = useSupabaseClient<Database>()
const route = useRoute()
const id = Number(route.params.id)
if (!Number.isInteger(id) || id < 1) throw createError({ statusCode: 404, statusMessage: 'هذه الصفحة غير موجودة', fatal: true })
const page = computed(() => Math.max(1, Number(route.query.page) || 1))
const { publicUrl } = useMediaUrl()

const { data: maker } = await useAsyncData(`maker:${id}`, () => getMaker(client, id))
if (!maker.value) throw createError({ statusCode: 404, statusMessage: 'هذه الصفحة غير موجودة', fatal: true })
const { data: books } = await useAsyncData(() => `maker-books:${id}:${page.value}`, () => listBooks(client, { makerId: id, page: page.value }), { watch: [page] })
useSeoMeta({ title: maker.value.name, description: `كتب ${maker.value.name}` })
</script>

<template>
  <div v-if="maker">
    <PageHeading :title="maker.name" />
    <section class="wp_maker">
      <div class="maker_info">
        <div class="row">
          <div class="col-lg-3">
            <div class="img-block"><img class="img-fluid" :alt="maker.name" :title="maker.name" :src="publicUrl(maker.image_path, '/assets/images/avatar.png')"></div>
            <div class="data">{{ maker.name }}</div>
            <div class="data job">{{ MAKER_KIND_LABEL[maker.kind] }}</div>
          </div>
          <div class="col-lg-9">
            <p class="about">نبذة عنه</p>
            <!-- bio_html is sanitised server-side on save (server/utils/sanitize.ts) -->
            <div class="words" v-html="maker.bio_html" />
          </div>
        </div>
      </div>
      <div class="wp_h3 title">الكتب</div>
      <div class="row">
        <div v-if="books && !books.items.length" class="col-12"><div class="alert alert-info">لا توجد كتب.</div></div>
        <template v-else-if="books">
          <BookCard v-for="b in books.items" :key="b.id" :book="b" variant="shop" />
          <AppPagination :page="books.page" :page-count="books.pageCount" />
        </template>
      </div>
    </section>
  </div>
</template>
