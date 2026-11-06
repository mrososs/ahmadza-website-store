<script setup lang="ts">
// dropify-look file chooser. Emits the chosen File; the server re-validates content (magic bytes) and size.
const props = defineProps<{ accept?: string; height?: number; maxBytes?: number }>()
const emit = defineEmits<{ file: [File | null] }>()
const name = ref('')
const err = ref('')
const input = ref<HTMLInputElement | null>(null)

function onChange(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0] ?? null
  err.value = ''
  if (f && props.maxBytes && f.size > props.maxBytes) {
    err.value = `الحجم الأقصى ${(props.maxBytes / 1048576).toFixed(0)} ميجا`
    clear()
    return
  }
  name.value = f?.name ?? ''
  emit('file', f)
}
function clear() {
  if (input.value) input.value.value = ''
  name.value = ''
  emit('file', null)
}
</script>

<template>
  <div>
    <div class="dropify-wrapper" :class="{ 'has-preview': !!name }" :style="height ? `height: ${height}px;` : undefined">
      <div class="dropify-message"><span class="file-icon" /> <p>{{ name || 'قم برفع المرفق من هنا' }}</p></div>
      <input ref="input" type="file" class="dropify" :accept="accept" aria-label="اختر ملفاً" @change="onChange">
      <button v-if="name" type="button" class="dropify-clear" style="display: block" @click="clear">حذف</button>
    </div>
    <div v-if="err" class="text-danger small mt-1" role="alert">{{ err }}</div>
  </div>
</template>
