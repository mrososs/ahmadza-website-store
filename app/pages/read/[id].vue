<script setup lang="ts">
// Full-screen friendly reader page. Access is decided by the server on every load (/api/reader/:id), never by this page.
const id = Number(useRoute().params.id)
if (!Number.isInteger(id) || id < 1) throw createError({ statusCode: 404, statusMessage: 'هذه الصفحة غير موجودة', fatal: true })
useSeoMeta({ title: 'قراءة الكتاب', robots: 'noindex, nofollow' })
</script>

<template>
  <div class="container py-3">
    <ClientOnly>
      <BookPdfReader :book-id="id" />
      <template #fallback><p class="text-center p-5" role="status">جاري تحميل القارئ…</p></template>
    </ClientOnly>
  </div>
</template>
