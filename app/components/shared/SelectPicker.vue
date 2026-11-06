<script setup lang="ts">
// bootstrap-select look-alike (legacy `select.selectpicker` is hidden by bootstrap-select.min.css and replaced by this DOM).
// A real <select> is kept in the DOM so the control also works for forms and assistive technology.
const props = defineProps<{ modelValue: string; options: { value: string; label: string }[]; title: string; name?: string }>()
const emit = defineEmits<{ 'update:modelValue': [string] }>()
const open = ref(false)
const root = ref<HTMLElement | null>(null)
const current = computed(() => props.options.find((o) => o.value === props.modelValue))

function pick(v: string) { emit('update:modelValue', v); open.value = false }
onMounted(() => {
  const close = (e: MouseEvent) => { if (!root.value?.contains(e.target as Node)) open.value = false }
  document.addEventListener('click', close)
  onBeforeUnmount(() => document.removeEventListener('click', close))
})
</script>

<template>
  <div ref="root" class="dropdown bootstrap-select form-control" :class="{ show: open }">
    <select class="form-control selectpicker" :name="name" tabindex="-98" :value="modelValue" @change="emit('update:modelValue', ($event.target as HTMLSelectElement).value)">
      <option v-for="o in options" :key="o.value" :value="o.value">{{ o.label }}</option>
    </select>
    <button type="button" class="btn dropdown-toggle btn-light" :class="{ 'bs-placeholder': !current }" role="combobox" :aria-expanded="open" :title="title" @click.stop="open = !open">
      <div class="filter-option"><div class="filter-option-inner"><div class="filter-option-inner-inner">{{ current?.label ?? title }}</div></div></div>
    </button>
    <div class="dropdown-menu" :class="{ show: open }">
      <div class="inner show">
        <ul class="dropdown-menu inner show" role="presentation" style="display: block; position: static; border: 0; float: none">
          <li v-for="o in options" :key="o.value">
            <a role="option" class="dropdown-item" :class="{ active: o.value === modelValue }" href="#" @click.prevent.stop="pick(o.value)"><span class="text">{{ o.label }}</span></a>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>
