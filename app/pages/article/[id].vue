<script setup lang="ts">
// Legacy URL /article/{id} -> canonical /post/{id}
await navigateTo(`/post/${String(useRoute().params.id)}`, { redirectCode: 301, replace: true })
</script>

<template><div /></template>
