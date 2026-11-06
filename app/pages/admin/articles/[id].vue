<script setup lang="ts">
// /admin/articles/create and /admin/articles/<id>
definePageMeta({ layout: 'admin', middleware: ['admin'] })
const raw = computed(() => String(useRoute().params.id))
const id = computed(() => (raw.value === 'create' ? undefined : Number(raw.value)))
useAdminTitle(() => (id.value ? 'تعديل الموضوع' : 'أضافة موضوع جديد'))
</script>

<template>
  <AdminEntityForm :id="id" :key="raw" entity="articles" />
</template>
