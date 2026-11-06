<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: ['admin'] })
useAdminTitle('المدونة')
</script>

<template>
  <AdminEntityList entity="articles" />
</template>
