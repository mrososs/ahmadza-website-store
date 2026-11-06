<script setup lang="ts">
// /admin/makers/create and /admin/makers/<id>
definePageMeta({ layout: 'admin', middleware: ['admin'] })
const raw = computed(() => String(useRoute().params.id))
const id = computed(() => (raw.value === 'create' ? undefined : Number(raw.value)))
useAdminTitle(() => (id.value ? 'تعديل بيانات' : 'أضافة مؤلف جديد'))
</script>

<template>
  <AdminEntityForm :id="id" :key="raw" entity="makers" />
</template>
