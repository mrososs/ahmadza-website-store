<script setup lang="ts">
// A short, clearly separated strip on the home page of the protected preview: "recovered, under review". Hidden entirely when the site is public or there is nothing to show.
import type { RecoveredPreviewItem } from '~~/shared/utils/recoveredPreview'

const summary = useRecoveredSummary()
const list = useFetch<{ items: RecoveredPreviewItem[] }>('/api/preview/recovered', { query: { limit: 8 }, key: 'recovered-home', server: false, lazy: true, immediate: false })
watch(() => summary.data.value?.enabled && summary.data.value.total > 0, (show) => { if (show) list.execute() }, { immediate: true })
</script>

<template>
  <section v-if="summary.data.value?.enabled && summary.data.value.total > 0" class="recovered-home" aria-labelledby="recovered-home-title">
    <div class="alert alert-warning" role="note">
      <strong id="recovered-home-title">كتب مستعادة ({{ summary.data.value.total }})</strong>
      <span> — عناوين من أرشيف الموقع القديم؛ لا يمكن شراؤها أو تنزيلها في المعاينة. </span>
      <NuxtLink to="/recovered">عرض الكل</NuxtLink>
    </div>
    <div v-if="list.data.value?.items?.length" class="row">
      <RecoveredCard v-for="b in list.data.value.items" :key="b.id" :item="b" />
    </div>
  </section>
</template>
