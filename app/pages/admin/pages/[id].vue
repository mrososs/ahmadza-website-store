<script setup lang="ts">
// /admin/pages/create and /admin/pages/<id>
definePageMeta({ layout: 'admin', middleware: ['admin'] })
const raw = computed(() => String(useRoute().params.id))
const id = computed(() => (raw.value === 'create' ? undefined : Number(raw.value)))
useAdminTitle(() => (id.value ? 'تعديل الصفحة' : 'أضافة صفحة جديدة'))
</script>

<template>
  <AdminEntityForm :id="id" :key="raw" entity="pages" />
</template>
