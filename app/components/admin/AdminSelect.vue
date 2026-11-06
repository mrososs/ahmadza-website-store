<script setup lang="ts">
// bootstrap-select look-alike (single / multiple / live search) with the legacy DOM + classes.
type Val = string | number
const props = defineProps<{
  modelValue: Val | Val[] | null | undefined
  options: { value: Val; label: string }[]
  title?: string
  multiple?: boolean
  live?: boolean
  id?: string
}>()
const emit = defineEmits<{ 'update:modelValue': [Val | Val[]] }>()

const open = ref(false)
const search = ref('')
const root = ref<HTMLElement | null>(null)

const selected = computed<Val[]>(() => (Array.isArray(props.modelValue) ? props.modelValue : props.modelValue === null || props.modelValue === undefined || props.modelValue === '' ? [] : [props.modelValue]))
const label = computed(() => {
  const chosen = props.options.filter((o) => selected.value.includes(o.value))
  return chosen.length ? chosen.map((o) => o.label).join(', ') : props.title ?? ''
})
const shown = computed(() => (search.value ? props.options.filter((o) => o.label.includes(search.value)) : props.options))

function pick(v: Val) {
  if (props.multiple) {
    emit('update:modelValue', selected.value.includes(v) ? selected.value.filter((x) => x !== v) : [...selected.value, v])
  } else {
    emit('update:modelValue', v)
    open.value = false
  }
}
onMounted(() => {
  const close = (e: MouseEvent) => { if (!root.value?.contains(e.target as Node)) open.value = false }
  document.addEventListener('click', close)
  onBeforeUnmount(() => document.removeEventListener('click', close))
})
</script>

<template>
  <div ref="root" class="dropdown bootstrap-select form-control" :class="{ show: open }">
    <button :id="id" type="button" class="btn dropdown-toggle btn-light" :class="{ 'bs-placeholder': !selected.length }" role="combobox" :aria-expanded="open" :title="label" @click.stop="open = !open">
      <div class="filter-option"><div class="filter-option-inner"><div class="filter-option-inner-inner">{{ label }}</div></div></div>
    </button>
    <div class="dropdown-menu" :class="{ show: open }">
      <div v-if="live" class="bs-searchbox"><input v-model="search" type="search" class="form-control" autocomplete="off" aria-label="بحث" @click.stop></div>
      <div class="inner show">
        <ul class="dropdown-menu inner show" role="presentation" style="display: block; position: static; border: 0; float: none">
          <li v-for="o in shown" :key="o.value" :class="{ 'selected active': selected.includes(o.value) }">
            <a role="option" class="dropdown-item" :class="{ 'active selected': selected.includes(o.value) }" href="#" @click.prevent.stop="pick(o.value)"><span class="text">{{ o.label }}</span></a>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>
