<script setup lang="ts">
// "plain" .book_block (image + title) for library / favourites. Test-mode entitlements are visibly marked.
import type { BookCardData } from '~~/shared/types/app'
import { BOOK_KIND_LABEL } from '~~/shared/constants'

const props = defineProps<{ book: BookCardData; isTest?: boolean; removable?: boolean }>()
const emit = defineEmits<{ remove: [] }>()
const href = computed(() => `/book/${props.book.id}/${props.book.slug || ''}`)
</script>

<template>
  <div class="col-xl-3 col-lg-4 col-6">
    <div class="book_block">
      <NuxtLink class="item" :to="href">
        <span class="type_book" :class="book.kind">{{ BOOK_KIND_LABEL[book.kind] }}</span>
        <span v-if="isTest" class="type_book paid" style="top: 24px" title="شراء تجريبي (بيئة تطوير) — ليس دفعاً حقيقياً">تجريبي</span>
        <div class="img-block"><CoverImage class="img-fluid lazyload" loading="lazy" :path="book.cover_path" :alt="book.title" /></div>
        <div class="info"><h3 class="name">{{ book.title }}</h3></div>
      </NuxtLink>
      <button v-if="removable" type="button" class="link removeCartBtn" @click="emit('remove')"><i class="fa fa-trash" /> إزالة من المفضلة</button>
    </div>
  </div>
</template>
