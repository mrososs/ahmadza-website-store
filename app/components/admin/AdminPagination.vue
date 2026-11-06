<script setup lang="ts">
const props = defineProps<{ page: number; total: number; pageSize: number }>()
const route = useRoute()
const pageCount = computed(() => Math.max(1, Math.ceil(props.total / props.pageSize)))
const link = (p: number) => ({ path: route.path, query: { ...route.query, page: p > 1 ? String(p) : undefined } })
const items = computed(() => {
  const c = pageCount.value, p = props.page
  if (c <= 7) return Array.from({ length: c }, (_, i) => i + 1)
  const out: (number | '…')[] = [1]
  const from = Math.max(2, p - 2), to = Math.min(c - 1, p + 2)
  if (from > 2) out.push('…')
  for (let i = from; i <= to; i++) out.push(i)
  if (to < c - 1) out.push('…')
  out.push(c)
  return out
})
</script>

<template>
  <nav v-if="pageCount > 1" aria-label="التنقل بين الصفحات">
    <ul class="pagination justify-content-center mt-3 mb-0">
      <li class="page-item" :class="{ disabled: page <= 1 }">
        <NuxtLink v-if="page > 1" class="page-link" :to="link(page - 1)">السابق</NuxtLink><span v-else class="page-link">السابق</span>
      </li>
      <template v-for="(it, i) in items" :key="i">
        <li v-if="it === '…'" class="page-item disabled"><span class="page-link">…</span></li>
        <li v-else class="page-item" :class="{ active: it === page }"><NuxtLink class="page-link" :to="link(it)">{{ it }}</NuxtLink></li>
      </template>
      <li class="page-item" :class="{ disabled: page >= pageCount }">
        <NuxtLink v-if="page < pageCount" class="page-link" :to="link(page + 1)">التالي</NuxtLink><span v-else class="page-link">التالي</span>
      </li>
    </ul>
  </nav>
</template>
