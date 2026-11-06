<script setup lang="ts">
// .social_article share buttons: static URL builders (no third-party scripts).
const props = defineProps<{ title: string; path: string }>()
const base = useRuntimeConfig().public.siteUrl as string
const url = computed(() => encodeURIComponent(base.replace(/\/$/, '') + props.path))
const text = computed(() => encodeURIComponent(props.title))
</script>

<template>
  <div class="social_article">
    <ul>
      <li class="facebook"><a :href="`https://www.facebook.com/sharer/sharer.php?u=${url}`" target="_blank" rel="noopener noreferrer" title="شارك على فيسبوك"><i class="fa fa-facebook" /></a></li>
      <li class="twitter"><a :href="`https://twitter.com/intent/tweet?url=${url}&text=${text}`" target="_blank" rel="noopener noreferrer" title="شارك على تويتر"><i class="fa fa-twitter" /></a></li>
      <li class="whatsapp"><a :href="`https://wa.me/?text=${text}%20${url}`" target="_blank" rel="noopener noreferrer" title="شارك على واتساب"><i class="fa fa-whatsapp" /></a></li>
      <li class="telegram"><a :href="`https://t.me/share/url?url=${url}&text=${text}`" target="_blank" rel="noopener noreferrer" title="شارك على تيلغرام"><i class="fa fa-telegram" /></a></li>
    </ul>
  </div>
</template>
