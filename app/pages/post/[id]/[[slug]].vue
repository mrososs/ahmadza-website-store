<script setup lang="ts">
// Port of resources/views/front/show-article.blade.php. content_html is sanitised server-side on save (sanitizeRichText).
import { getArticle } from '~~/shared/queries/catalog'
import type { Database } from '~~/shared/types/database.types'

const client = useSupabaseClient<Database>()
const route = useRoute()
const id = Number(route.params.id)
if (!Number.isInteger(id) || id < 1) throw createError({ statusCode: 404, statusMessage: 'هذه الصفحة غير موجودة', fatal: true })
const { publicUrl } = useMediaUrl()
const { data: article } = await useAsyncData(`article:${id}`, () => getArticle(client, id))
if (!article.value) throw createError({ statusCode: 404, statusMessage: 'هذه الصفحة غير موجودة', fatal: true })

const { liked, toggle } = useFavourite('article', id)
const date = computed(() => article.value ? new Intl.DateTimeFormat('ar', { dateStyle: 'medium' }).format(new Date(article.value.created_at)) : '')
useSeoMeta({
  title: article.value.title,
  description: article.value.excerpt ?? undefined,
  ogTitle: article.value.title,
  ogDescription: article.value.excerpt ?? undefined,
  ogImage: article.value.poster_path ? publicUrl(article.value.poster_path) : undefined,
})
onMounted(() => {
  const key = `aw_viewed_article_${id}`
  try { if (sessionStorage.getItem(key)) return; sessionStorage.setItem(key, '1') } catch { /* ignore */ }
  $fetch(`/api/views/article/${id}`, { method: 'POST' }).catch(() => {})
})
</script>

<template>
  <div v-if="article">
    <PageHeading :title="article.title" />
    <section class="article_content">
      <div class="head_article">
        <div class="row">
          <div class="col-12 text-center mb-2"><img :title="article.title" :alt="article.title" :src="publicUrl(article.poster_path)" class="img-fluid"></div>
          <div class="col-lg-2 col-md-6 col-sm-2 col-6"><p class="info"><i class="fa fa-eye" /> {{ article.view_count }}</p></div>
          <div class="col-lg-2 col-md-6 col-sm-3 col-6">
            <button class="updateFavourite" type="button" @click="toggle"><i class="fa fa-heart" :class="{ liked_heart: liked }" /> المفضلة</button>
          </div>
          <div class="col-lg-4 col-md-6 col-sm-3 col-6"><p class="info"><i class="fa fa-clock" /> {{ date }}</p></div>
          <div class="col-lg-4 col-md-6 col-sm-4 col-6"><ShareLinks class="mt-2" :title="article.title" :path="`/post/${article.id}`" /></div>
        </div>
      </div>
      <div class="paragragh mt-2 editor_txt" v-html="article.content_html" />
    </section>
  </div>
</template>
