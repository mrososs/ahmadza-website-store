<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: ['admin'] })
useAdminTitle('المؤلفين')
</script>

<template>
  <AdminEntityList entity="makers" />
</template>
