<script setup lang="ts">
// Webmin/Bootstrap-4 modal look (.modal.main-model) controlled by Vue state.
const props = defineProps<{ open: boolean; title: string; danger?: boolean }>()
const emit = defineEmits<{ close: [] }>()

watch(() => props.open, (o) => { if (import.meta.client) document.body.classList.toggle('modal-open', o) })
onBeforeUnmount(() => { if (import.meta.client) document.body.classList.remove('modal-open') })
</script>

<template>
  <Teleport to="body">
    <template v-if="open">
      <div class="modal main-model show" style="display: block" role="dialog" aria-modal="true" :aria-label="title" tabindex="-1" @click.self="emit('close')" @keydown.esc="emit('close')">
        <div class="modal-dialog modal-dialog-centered" role="document">
          <div class="modal-content modal-content-demo">
            <div class="modal-header"><h6 class="modal-title text-center" :class="{ 'text-danger': danger }">{{ title }}</h6></div>
            <div class="modal-body"><slot /></div>
            <div class="modal-footer">
              <slot name="footer" />
              <button class="btn ripple btn-secondary" type="button" @click="emit('close')">أغلاق</button>
            </div>
          </div>
        </div>
      </div>
      <div class="modal-backdrop show" />
    </template>
  </Teleport>
</template>
