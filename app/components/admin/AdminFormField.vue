<script setup lang="ts">
defineProps<{ label: string; required?: boolean; error?: string; hint?: string; for?: string }>()
</script>

<template>
  <div class="form-group">
    <label :for="$props.for">{{ label }} <span v-if="required" class="required_mark">*</span></label>
    <slot />
    <small v-if="hint" class="form-text text-muted">{{ hint }}</small>
    <div v-if="error" class="text-danger small mt-1" role="alert">{{ error }}</div>
  </div>
</template>
