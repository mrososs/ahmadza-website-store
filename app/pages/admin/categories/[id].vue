<script setup lang="ts">
// /admin/categories/create and /admin/categories/<id>
definePageMeta({ layout: 'admin', middleware: ['admin'] })
const raw = computed(() => String(useRoute().params.id))
const id = computed(() => (raw.value === 'create' ? undefined : Number(raw.value)))
useAdminTitle(() => (id.value ? 'تعديل القسم' : 'أضافة قسم جديد'))
</script>

<template>
  <AdminEntityForm :id="id" :key="raw" entity="categories" />
</template>
