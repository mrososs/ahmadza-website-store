<script setup lang="ts">
useCanonical('/')
definePageMeta({ showPoster: true, showStats: true })
</script>

<template>
  <div>
    <PageHeading title="الرئيسية" />
    <BookListing />
  </div>
</template>
