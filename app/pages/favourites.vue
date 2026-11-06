<script setup lang="ts">
// Port of resources/views/front/favourite.blade.php (tabs: books / articles). Own rows only (RLS).
import { listFavourites, removeFavourite } from '~~/shared/queries/commerce'
import type { Database } from '~~/shared/types/database.types'

definePageMeta({ middleware: 'auth' })
const client = useSupabaseClient<Database>()
const { publicUrl } = useMediaUrl()
const tab = ref<'book' | 'article'>('book')
const { data, status, error, refresh } = await useAsyncData('favourites', () => listFavourites(client), { server: false, default: () => ({ books: [], articles: [] }) })

async function remove(id: number) {
  await removeFavourite(client, id)
  await refresh()
}
const ago = (iso: string) => `منذ ${Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000))} يوم`
</script>

<template>
  <div>
    <PageHeading title="قائمة المفضلة" />
    <section class="wp_favourite">
      <ul class="nav nav-tabs" role="tablist">
        <li class="nav-item" role="presentation">
          <button id="book-tab" class="nav-link" :class="{ active: tab === 'book' }" type="button" role="tab" aria-controls="book" :aria-selected="tab === 'book'" @click="tab = 'book'">الكتب</button>
        </li>
        <li class="nav-item" role="presentation">
          <button id="article-tab" class="nav-link" :class="{ active: tab === 'article' }" type="button" role="tab" aria-controls="article" :aria-selected="tab === 'article'" @click="tab = 'article'">المقالات</button>
        </li>
      </ul>
      <div v-if="error" class="alert alert-danger mt-2" role="alert">تعذر تحميل المفضلة. <a href="#" @click.prevent="refresh()">إعادة المحاولة</a></div>
      <div v-else-if="(status === 'pending' || status === 'idle')" class="text-center p-5" role="status"><i class="fa fa-spinner fa-spin" /> جاري التحميل…</div>
      <div v-else class="tab-content">
        <div v-show="tab === 'book'" id="book" class="tab-pane fade show active" role="tabpanel" aria-labelledby="book-tab">
          <div class="row">
            <div v-if="!data.books.length" class="col-12"><div class="alert alert-info" role="status">لا توجد كتب في المفضلة.</div></div>
            <LibraryBookCard v-for="f in data.books" :key="f.favouriteId" :book="f.book" removable @remove="remove(f.favouriteId)" />
          </div>
        </div>
        <div v-show="tab === 'article'" id="article" class="tab-pane fade show active" role="tabpanel" aria-labelledby="article-tab">
          <div class="row">
            <div v-if="!data.articles.length" class="col-12"><div class="alert alert-info" role="status">لا توجد مقالات في المفضلة.</div></div>
            <div v-for="f in data.articles" :key="f.favouriteId" class="col-12">
              <NuxtLink :to="`/post/${f.article.id}`" class="item article_block">
                <div class="row">
                  <div class="col-lg-3 col-sm-4 col-12">
                    <div class="img-block"><img :src="publicUrl(f.article.poster_path)" :title="f.article.title" :alt="f.article.title" class="img-fluid"></div>
                  </div>
                  <div class="col-lg-9 col-sm-8 col-12">
                    <p class="title">{{ f.article.title }}</p>
                    <p class="pref">{{ f.article.excerpt }}</p>
                    <span class="icon"><i class="fa fa-clock-o" /> {{ ago(f.article.created_at) }}</span>
                    <span class="icon view"><i class="fa fa-eye" /> {{ f.article.view_count }}</span>
                  </div>
                </div>
              </NuxtLink>
              <button type="button" class="link removeCartBtn" @click="remove(f.favouriteId)"><i class="fa fa-trash" /> إزالة من المفضلة</button>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
