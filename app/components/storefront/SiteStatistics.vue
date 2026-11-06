<script setup lang="ts">
// Port of resources/views/front/statistics.blade.php (three active blocks) with the legacy count-up behaviour.
const { data: shell } = await useShell()
const stats = computed(() => [
  { icon: 'fa-book', name: 'الكتب', end: shell.value?.stats.books ?? 0 },
  { icon: 'fa-eye', name: 'المشاهدات', end: shell.value?.stats.views ?? 0 },
  { icon: 'fa-comment', name: 'المقالات', end: shell.value?.stats.articles ?? 0 },
])
const shown = ref<number[]>([0, 0, 0])
onMounted(() => {
  const ends = stats.value.map((s) => s.end)
  let frame = 0
  const step = () => {
    shown.value = shown.value.map((v, i) => Math.min(ends[i]!, v + Math.max(1, Math.ceil(ends[i]! / 90))))
    if (shown.value.some((v, i) => v < ends[i]!)) frame = requestAnimationFrame(step)
  }
  frame = requestAnimationFrame(step)
  onBeforeUnmount(() => cancelAnimationFrame(frame))
})
</script>

<template>
  <section class="statistics_wp" style="background-image: url(/assets/images/new-bg.webp)">
    <div class="frame">
      <div class="container">
        <h2 class="title">احصائيات الموقع</h2>
        <div class="row">
          <div v-for="(s, i) in stats" :key="s.name" class="col-lg-4 col-md-6">
            <div class="block">
              <i class="fa" :class="s.icon" />
              <p class="st_name">{{ s.name }}</p>
              <p class="st_count">{{ shown[i] }}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
