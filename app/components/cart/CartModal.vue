<script setup lang="ts">
// Legacy Bootstrap-4 modal markup, driven by Vue state (class "show" + backdrop). Used for the cart login and the pledge gate.
const props = defineProps<{ open: boolean; modalClass?: string; id?: string }>()
const emit = defineEmits<{ close: [] }>()
watch(() => props.open, (v) => { if (import.meta.client) document.body.classList.toggle('modal-open', v) })
onBeforeUnmount(() => { if (import.meta.client) document.body.classList.remove('modal-open') })
</script>

<template>
  <div>
    <div :id="id" class="modal" :class="[modalClass, { show: open }]" :style="{ display: open ? 'block' : 'none' }" role="dialog" aria-modal="true" @click.self="emit('close')">
      <div class="modal-dialog">
        <div class="modal-content"><slot /></div>
      </div>
    </div>
    <div v-if="open" class="modal-backdrop show" />
  </div>
</template>
