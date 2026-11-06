<script setup lang="ts">
// Port of admin/user/index.blade.php (ADM-01/02): status filter via the sidebar, status change modal, soft delete / restore.
definePageMeta({ layout: 'admin', middleware: ['admin'] })
useAdminTitle('المستخدمين')

interface Row { id: string; email: string; display_name: string; status: 'active' | 'review' | 'banned'; is_affiliate: boolean; created_at: string; deleted_at: string | null }
const { data, pending, errorText, refresh, query } = useAdminList<Row>('/api/admin/users')
const columns = [
  { key: 'n', label: '#', cls: 'wd-5p' }, { key: 'display_name', label: 'الاسم', cls: 'wd-20p' }, { key: 'email', label: 'البريد الالكترونى', cls: 'wd-25p' },
  { key: 'type', label: 'النوع', cls: 'wd-10p' }, { key: 'status', label: 'الحالة', cls: 'wd-10p' }, { key: 'created_at', label: 'تاريخ التسجيل', cls: 'wd-15p' }, { key: 'ops', label: 'عمليات', cls: 'wd-15p' },
]
const STATUS = { active: { l: 'مفعل', c: 'badge-success' }, review: { l: 'تحت المراجعة', c: 'badge-warning' }, banned: { l: 'محظور', c: 'badge-danger' } } as const
const trash = computed(() => query.value.status === 'trash')

const target = ref<Row | null>(null)
const mode = ref<'status' | 'delete' | 'restore'>('status')
const newStatus = ref<'active' | 'review' | 'banned'>('active')
const busy = ref(false)
const err = ref('')
function ask(r: Row, m: typeof mode.value) { target.value = r; mode.value = m; newStatus.value = r.status; err.value = '' }
async function confirm() {
  if (!target.value) return
  busy.value = true
  try {
    const id = target.value.id
    if (mode.value === 'status') await adminFetch(`/api/admin/users/${id}`, { method: 'PATCH', body: { status: newStatus.value } })
    else await adminFetch(`/api/admin/users/${id}${mode.value === 'restore' ? '/restore' : ''}`, { method: mode.value === 'restore' ? 'POST' : 'DELETE' })
    target.value = null
    await refresh()
  } catch (e) { err.value = (e as Error).message } finally { busy.value = false }
}
const modalTitle = computed(() => ({ status: 'تغير حالة المستخدم', delete: 'حذف', restore: 'استرجاع' })[mode.value])
</script>

<template>
  <div class="row">
    <div class="col-12 mb-30">
      <AdminDataTable :columns="columns" :rows="data?.items" :loading="pending" :error="errorText" :total="data?.total" :page="data?.page" :page-size="data?.pageSize" searchable search-placeholder="الاسم أو البريد" @retry="refresh()">
        <template #cell-n="{ index }">{{ ((data?.page ?? 1) - 1) * (data?.pageSize ?? 20) + index + 1 }}</template>
        <template #cell-type="{ row }">{{ row.is_affiliate ? 'مسوق' : 'عميل' }}</template>
        <template #cell-status="{ row }"><span class="badge" :class="STATUS[row.status].c">{{ STATUS[row.status].l }}</span></template>
        <template #cell-created_at="{ row }">{{ fmtDate(row.created_at) }}</template>
        <template #cell-ops="{ row }">
          <div>
            <button aria-expanded="false" aria-haspopup="true" class="btn ripple btn-sm btn-primary" data-toggle="dropdown" type="button">عمليات <i class="fa fa-caret-down ml-1" /></button>
            <div class="dropdown-menu tx-13">
              <NuxtLink class="dropdown-item" :to="`/admin/users/${row.id}`"><i class="fa fa-user" /> الملف الشخصى</NuxtLink>
              <template v-if="!trash">
                <a class="dropdown-item" href="#" @click.prevent="ask(row, 'status')"><i class="fa fa-edit" /> تغيير الحالة</a>
                <a class="dropdown-item" href="#" @click.prevent="ask(row, 'delete')"><i class="fa fa-trash" /> حذف</a>
              </template>
              <a v-else class="dropdown-item" href="#" @click.prevent="ask(row, 'restore')"><i class="fa fa-undo" /> استرجاع</a>
            </div>
          </div>
        </template>
      </AdminDataTable>
    </div>
    <AdminModal :open="!!target" :title="modalTitle" :danger="mode === 'delete'" @close="target = null">
      <div class="form-group"><label>الأسم الحقيقى</label><input readonly class="form-control" :value="target?.display_name"></div>
      <div class="form-group"><label>البريد الالكترونى</label><input readonly class="form-control" :value="target?.email"></div>
      <div v-if="mode === 'status'" class="form-group">
        <label>الحالة</label>
        <AdminSelect :model-value="newStatus" @update:model-value="newStatus = $event as never" title="أختر الحالة" :options="[{ value: 'review', label: 'تحت المراجعة' }, { value: 'active', label: 'مفعل' }, { value: 'banned', label: 'محظور' }]" />
      </div>
      <div v-if="err" class="alert alert-danger" role="alert">{{ err }}</div>
      <template #footer><button class="btn ripple" :class="mode === 'delete' ? 'btn-danger' : 'btn-success'" type="button" :disabled="busy" @click="confirm">{{ mode === 'delete' ? 'حذف' : mode === 'restore' ? 'استرجاع' : 'حفظ' }}</button></template>
    </AdminModal>
  </div>
</template>
