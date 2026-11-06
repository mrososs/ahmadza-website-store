<script setup lang="ts">
// Port of admin/contactus/index.blade.php (ADM-16): inbox with handled flag and delete.
definePageMeta({ layout: 'admin', middleware: ['admin'] })
useAdminTitle('الرسائل')

interface Row { id: number; name: string; email: string; subject: string; message: string; is_handled: boolean; created_at: string }
const route = useRoute()
const { data, pending, errorText, refresh } = useAdminList<Row>('/api/admin/contacts', () => ({ status: typeof route.query.status === 'string' ? route.query.status : undefined }))
const columns = [
  { key: 'id', label: '#', cls: 'wd-5p' }, { key: 'name', label: 'الاسم' }, { key: 'email', label: 'البريد الالكترونى' }, { key: 'subject', label: 'الموضوع' },
  { key: 'message', label: 'الرسالة' }, { key: 'created_at', label: 'التاريخ' }, { key: 'ops', label: 'عمليات' },
]
const SUBJECT: Record<string, string> = { note: 'ملاحظة', request: 'طلب', report: 'إبلاغ', other: 'أخرى' }
const err = ref('')
const view = ref<Row | null>(null)
const del = ref<Row | null>(null)

async function toggle(r: Row) {
  try { await adminFetch(`/api/admin/contacts/${r.id}`, { method: 'PATCH', body: { is_handled: !r.is_handled } }); await refresh() } catch (e) { err.value = (e as Error).message }
}
async function remove() {
  if (!del.value) return
  try { await adminFetch(`/api/admin/contacts/${del.value.id}`, { method: 'DELETE' }); del.value = null; await refresh() } catch (e) { err.value = (e as Error).message; del.value = null }
}
</script>

<template>
  <div class="row">
    <div v-if="err" class="col-12"><div class="alert alert-danger" role="alert">{{ err }}</div></div>
    <div class="col-12 mb-3">
      <NuxtLink class="btn btn-sm btn-light" to="/admin/contacts">الكل</NuxtLink>
      <NuxtLink class="btn btn-sm btn-warning" :to="{ path: '/admin/contacts', query: { status: 'open' } }">غير معالجة</NuxtLink>
      <NuxtLink class="btn btn-sm btn-success" :to="{ path: '/admin/contacts', query: { status: 'handled' } }">تمت المعالجة</NuxtLink>
    </div>
    <div class="col-12 mb-30">
      <AdminDataTable :columns="columns" :rows="data?.items" :loading="pending" :error="errorText" :total="data?.total" :page="data?.page" :page-size="data?.pageSize" @retry="refresh()">
        <template #cell-subject="{ row }">{{ SUBJECT[row.subject] ?? row.subject }}</template>
        <template #cell-message="{ row }">{{ row.message.length > 60 ? `${row.message.slice(0, 60)}…` : row.message }}</template>
        <template #cell-created_at="{ row }">{{ fmtDateTime(row.created_at) }} <span v-if="row.is_handled" class="badge badge-success">تمت المعالجة</span></template>
        <template #cell-ops="{ row }">
          <button class="btn btn-sm btn-primary" type="button" title="عرض" @click="view = row"><i class="fa fa-eye" /></button>
          <button class="btn btn-sm" :class="row.is_handled ? 'btn-warning' : 'btn-success'" type="button" :title="row.is_handled ? 'إعادة فتح' : 'تمت المعالجة'" @click="toggle(row)"><i class="fa" :class="row.is_handled ? 'fa-undo' : 'fa-check'" /></button>
          <button class="btn btn-sm btn-danger" type="button" title="حذف" @click="del = row"><i class="fa fa-trash" /></button>
        </template>
      </AdminDataTable>
    </div>
    <AdminModal :open="!!view" title="الرسالة" @close="view = null">
      <div class="form-group"><label>ألاسم</label><input readonly class="form-control" :value="view?.name"></div>
      <div class="form-group"><label>البريد الالكترونى</label><input readonly class="form-control" dir="ltr" :value="view?.email"></div>
      <div class="form-group"><label>الرسالة</label><textarea readonly class="form-control" rows="6" :value="view?.message" /></div>
    </AdminModal>
    <AdminModal :open="!!del" title="حذف" danger @close="del = null">
      <div class="form-group"><label>ألاسم</label><input readonly class="form-control" :value="del?.name"></div>
      <div class="form-group"><label>البريد الالكترونى</label><input readonly class="form-control" dir="ltr" :value="del?.email"></div>
      <template #footer><button class="btn ripple btn-danger" type="button" @click="remove">حذف</button></template>
    </AdminModal>
  </div>
</template>
