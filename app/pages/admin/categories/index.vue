<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: ['admin'] })
useAdminTitle('الأقسام')
</script>

<template>
  <AdminEntityList entity="categories" />
</template>
