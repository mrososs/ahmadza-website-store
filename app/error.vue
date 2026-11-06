<script setup lang="ts">
// Port of resources/views/404.blade.php (legacy .not_found look) for 404; other errors show a generic message.
import type { NuxtError } from '#app'

const props = defineProps<{ error: NuxtError }>()
const is404 = computed(() => props.error.statusCode === 404)
useHead({
  link: ['/assets/css/plugins/bootstrap.css', '/assets/css/plugins/font-awesome.css', '/assets/css/front.css', '/assets/css/media.css']
    .map((href) => ({ rel: 'stylesheet', href })),
})
</script>

<template>
  <NuxtLayout name="default">
    <div class="not_found">
      <div class="container">
        <h1>{{ is404 ? 404 : error.statusCode }}</h1>
        <p>{{ is404 ? 'هذه الصفحة غير موجودة' : 'حدث خطأ غير متوقع' }}</p>
        <p><a href="/" @click.prevent="clearError({ redirect: '/' })">العودة للرئيسية</a></p>
      </div>
    </div>
  </NuxtLayout>
</template>
