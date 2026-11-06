<script setup lang="ts">
// A book cover. A recovered book can record a cover whose file is not in storage (yet): instead of a broken image it shows the default cover.
// The failed state lives here (not on the DOM node) so Vue's own `src` binding never overwrites the fallback after hydration. Images that already
// failed while the server-rendered HTML loaded, before any listener existed, are caught on mount.
defineOptions({ inheritAttrs: false })
const props = defineProps<{ path: string | null | undefined; alt: string }>()
const { publicUrl } = useMediaUrl()
const el = ref<HTMLImageElement | null>(null)
const failed = ref(false)
watch(() => props.path, () => { failed.value = false })
const src = computed(() => (failed.value ? DEFAULT_COVER : publicUrl(props.path)))
onMounted(() => {
  const img = el.value
  if (img && props.path && img.complete && img.naturalWidth === 0) failed.value = true
})
</script>

<template>
  <img ref="el" v-bind="$attrs" :src="src" :alt="alt" @error="failed = true">
</template>
