<script setup lang="ts">
definePageMeta({ showPoster: true, showStats: true })
useSeoMeta({ robots: 'noindex, follow' })
useCanonical('/search')
</script>

<template>
  <div>
    <PageHeading title="الرئيسية" />
    <BookListing />
  </div>
</template>
