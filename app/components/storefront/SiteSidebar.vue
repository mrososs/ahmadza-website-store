<script setup lang="ts">
// Port of resources/views/front/side.blade.php — "newest articles" block (present on every storefront page).
const { data: shell } = await useShell()
</script>

<template>
  <section class="side_wp">
    <div class="block">
      <h3 class="wp_h3">أحدث المقالات</h3>
      <div class="data">
        <NuxtLink v-for="a in shell?.latestArticles ?? []" :key="a.id" :to="`/post/${a.id}`" class="item" :title="a.title">
          <span class="name">{{ a.title }}</span>
          <span class="icon view"><i class="fa fa-eye" /> {{ a.view_count }}</span>
        </NuxtLink>
      </div>
    </div>
  </section>
</template>
