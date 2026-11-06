<script setup lang="ts">
// Category / author card (front/category.blade.php, front/makers.blade.php): image card, optional "عرض الكتب" button.
const props = defineProps<{ to: string; name: string; image: string; browseTo?: string }>()
const isPlaceholder = computed(() => /default-cover|avatar.(webp|png)$/.test(props.image))
</script>

<template>
  <div class="col-xl-3 col-lg-4 col-6">
    <div class="block book_block">
      <NuxtLink class="item" :to="to">
        <div class="img-block" :class="{ 'is-placeholder': isPlaceholder }"><img class="img-fluid lazyload" loading="lazy" :alt="name" :title="name" :src="image"></div>
        <div class="info"><h3 class="name">{{ name }}</h3></div>
      </NuxtLink>
      <NuxtLink v-if="browseTo" :to="browseTo" class="wp_btn btn-block cart"><i class="fa fa-eye" /> عرض الكتب</NuxtLink>
    </div>
  </div>
</template>
