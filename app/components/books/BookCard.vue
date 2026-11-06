<script setup lang="ts">
// .book_block card — port of the markup in resources/views/front/home.blade.php.
// variant "shop" shows the price + add-to-cart strip, "plain" (library, favourites, related) only image + title.
import type { BookCardData } from '~~/shared/types/app'
import { BOOK_KIND_LABEL } from '~~/shared/constants'

const props = withDefaults(defineProps<{ book: BookCardData; variant?: 'shop' | 'plain'; to?: string }>(), { variant: 'shop' })
const cart = useCartStore()
const added = ref(false)

const href = computed(() => props.to ?? `/book/${props.book.id}/${props.book.slug || ''}`)
const canBuy = computed(() => props.book.kind === 'paid' && props.book.status === 'published')
const price = computed(() => Number(props.book.price_amount).toFixed(2))
const hasCover = computed(() => !!props.book.cover_path)

function addToCart() {
  if (!canBuy.value) return
  cart.add(props.book.id)
  added.value = true
  setTimeout(() => { added.value = false }, 1000)
}
</script>

<template>
  <div class="col-xl-3 col-lg-4 col-6">
    <div class="book_block" :class="{ block: variant === 'shop' }">
      <NuxtLink class="item" :to="href" :aria-label="book.title">
        <span class="type_book" :class="book.kind">{{ BOOK_KIND_LABEL[book.kind] }}</span>
        <div class="img-block" :class="{ 'is-placeholder': !hasCover }">
          <CoverImage class="img-fluid lazyload" loading="lazy" :path="book.cover_path" :alt="book.title" />
        </div>
        <div class="info"><h3 class="name">{{ book.title }}</h3></div>
      </NuxtLink>
      <div v-if="variant === 'shop'" class="under">
        <div class="row">
          <div class="col-8">
            <p class="price">
              <span v-if="book.kind === 'free'" class="cost cost--free">مجاني</span>
              <template v-else>
                <span class="cost">{{ price }}</span> <span class="currency">دولار</span>
              </template>
            </p>
          </div>
          <div class="col-4 text-right">
            <button
              type="button" title="أضف إلى السلة" class="wp_btn cart" :class="canBuy ? 'addToCartBtn' : 'disable_btn'"
              :disabled="!canBuy" :aria-label="canBuy ? `أضف ${book.title} إلى السلة` : `${book.title} — غير متاح للشراء`" @click="addToCart"
            >
              <i class="fa" :class="added || (canBuy && cart.has(book.id)) ? 'fa-check' : 'fa-cart-plus'" />
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
