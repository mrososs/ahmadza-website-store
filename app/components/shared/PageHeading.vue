<script setup lang="ts">
// The legacy storefront page title: <h3 class="wp_h3"> inside the content column (front/master.blade.php).
const props = defineProps<{ title: string }>()
useHead({ title: () => props.title })
</script>

<template>
  <h3 class="wp_h3">{{ title }}</h3>
</template>
