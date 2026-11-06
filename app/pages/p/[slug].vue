<script setup lang="ts">
// Port of resources/views/front/page.blade.php (CMS page, GET /p/{url}). HTML is sanitised on save.
import { getPage } from '~~/shared/queries/catalog'
import type { Database } from '~~/shared/types/database.types'

const client = useSupabaseClient<Database>()
const slug = String(useRoute().params.slug)
const { data: page } = await useAsyncData(`page:${slug}`, () => getPage(client, slug))
if (!page.value) throw createError({ statusCode: 404, statusMessage: 'هذه الصفحة غير موجودة', fatal: true })
useHead({ style: [{ innerHTML: ".fx_page{font-family:'Droid' !important;}" }] })
</script>

<template>
  <div v-if="page">
    <PageHeading :title="page.title" />
    <section class="fx_page">
      <div class="container" v-html="page.content_html" />
    </section>
  </div>
</template>
