<script setup lang="ts">
// Legacy URL /product/{id} -> canonical /book/{id}
await navigateTo(`/book/${String(useRoute().params.id)}`, { redirectCode: 301, replace: true })
</script>

<template><div /></template>
