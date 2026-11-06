<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: ['admin'] })
useAdminTitle('الصفحات')
</script>

<template>
  <AdminEntityList entity="pages" />
</template>
