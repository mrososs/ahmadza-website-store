<script setup lang="ts">
// /admin/books/create  and  /admin/books/<id>  (edit)
definePageMeta({ layout: 'admin', middleware: ['admin'] })
const route = useRoute()
const raw = computed(() => String(route.params.id))
const id = computed(() => (raw.value === 'create' ? undefined : Number(raw.value)))
useAdminTitle(() => (id.value ? 'تعديل بيانات الكتاب' : 'أضافة كتاب جديد'))
</script>

<template>
  <BookForm :id="id" :key="raw" />
</template>
