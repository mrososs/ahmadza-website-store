<script setup lang="ts">
// dropify look-alike (legacy DOM + classes) around a real <input type="file">; the input overlays the wrapper exactly
// as dropify.css expects, so clicking / dropping works natively without the dropify jQuery plugin.
const props = defineProps<{ name: string; accept?: string; height?: number; modelValue?: File | null }>()
const emit = defineEmits<{ 'update:modelValue': [File | null] }>()
const fileName = ref('')
const input = ref<HTMLInputElement | null>(null)

watch(() => props.modelValue, (f) => { if (!f) { fileName.value = ''; if (input.value) input.value.value = '' } })
function onChange(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0] ?? null
  fileName.value = f?.name ?? ''
  emit('update:modelValue', f)
}
function clear() { fileName.value = ''; if (input.value) input.value.value = ''; emit('update:modelValue', null) }
</script>

<template>
  <div class="dropify-wrapper" :class="{ 'has-preview': !!fileName }" :style="height ? `height: ${height}px;` : undefined">
    <div class="dropify-message"><span class="file-icon" /> <p>قم برفع المرفق من هنا</p><p class="dropify-error">حدث خطأ</p></div>
    <div class="dropify-loader" />
    <div class="dropify-errors-container"><ul /></div>
    <input ref="input" type="file" :name="name" class="dropify" :accept="accept" :data-height="height" :aria-label="name" @change="onChange">
    <button type="button" class="dropify-clear" @click.stop="clear">حذف</button>
    <div class="dropify-preview" :style="fileName ? 'display: block;' : undefined">
      <span class="dropify-render" />
      <div class="dropify-infos">
        <div class="dropify-infos-inner">
          <p class="dropify-filename"><span class="dropify-filename-inner">{{ fileName }}</span></p>
          <p class="dropify-infos-message">قم برفع المرفق من هنا</p>
        </div>
      </div>
    </div>
  </div>
</template>
