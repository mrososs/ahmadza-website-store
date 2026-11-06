<script setup lang="ts">
// Laravel useBootstrap() pagination inside .wp_page_number (URL query driven: ?page=N).
const props = defineProps<{ page: number; pageCount: number }>()
const route = useRoute()

const link = (p: number) => ({ path: route.path, query: { ...route.query, page: p > 1 ? String(p) : undefined } })

// compact window with first/last and ellipses once there are many pages
const items = computed(() => {
  const { page, pageCount } = props
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1)
  const out: (number | '…')[] = [1]
  const from = Math.max(2, page - 2), to = Math.min(pageCount - 1, page + 2)
  if (from > 2) out.push('…')
  for (let i = from; i <= to; i++) out.push(i)
  if (to < pageCount - 1) out.push('…')
  out.push(pageCount)
  return out
})
</script>

<template>
  <div v-if="pageCount > 1" class="col-12">
    <div class="col-12">
      <div class="wp_page_number">
        <nav aria-label="التنقل بين الصفحات">
          <ul class="pagination">
            <li class="page-item" :class="{ disabled: page <= 1 }">
              <span v-if="page <= 1" class="page-link" aria-hidden="true">&lsaquo;</span>
              <NuxtLink v-else class="page-link" :to="link(page - 1)" rel="prev" aria-label="السابق">&lsaquo;</NuxtLink>
            </li>
            <template v-for="(it, i) in items" :key="i">
              <li v-if="it === '…'" class="page-item disabled"><span class="page-link">…</span></li>
              <li v-else-if="it === page" class="page-item active" aria-current="page"><span class="page-link">{{ it }}</span></li>
              <li v-else class="page-item"><NuxtLink class="page-link" :to="link(it)">{{ it }}</NuxtLink></li>
            </template>
            <li class="page-item" :class="{ disabled: page >= pageCount }">
              <span v-if="page >= pageCount" class="page-link" aria-hidden="true">&rsaquo;</span>
              <NuxtLink v-else class="page-link" :to="link(page + 1)" rel="next" aria-label="التالي">&rsaquo;</NuxtLink>
            </li>
          </ul>
        </nav>
      </div>
    </div>
  </div>
</template>
