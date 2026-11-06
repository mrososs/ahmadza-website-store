<script setup lang="ts">
// Port of admin/comment/index.blade.php (CAT-25): moderation queue (approve / reject / visible to non-buyers / delete).
definePageMeta({ layout: 'admin', middleware: ['admin'] })
useAdminTitle('التعليقات')

interface Row { id: number; body: string; status: 'pending' | 'approved' | 'rejected'; visible_to_public: boolean; created_at: string; book_id: number; books: { title: string } | null; profiles: { display_name: string } | null }
const route = useRoute()
const { data, pending, errorText, refresh } = useAdminList<Row>('/api/admin/comments', () => ({
  status: typeof route.query.status === 'string' ? route.query.status : undefined, book: typeof route.query.book === 'string' ? route.query.book : undefined,
}))
const columns = [
  { key: 'id', label: '#', cls: 'wd-5p' }, { key: 'user', label: 'المستخدم' }, { key: 'book', label: 'الكتاب' }, { key: 'body', label: 'التعليق' },
  { key: 'status', label: 'الحالة' }, { key: 'visible', label: 'ظاهر للجميع' }, { key: 'created_at', label: 'التاريخ' }, { key: 'ops', label: 'عمليات' },
]
const STATUS = { pending: { l: 'قيد المراجعة', c: 'badge-warning' }, approved: { l: 'مقبول', c: 'badge-success' }, rejected: { l: 'مرفوض', c: 'badge-danger' } } as const
const err = ref('')
const del = ref<Row | null>(null)

async function patch(r: Row, body: Record<string, unknown>) {
  try { await adminFetch(`/api/admin/comments/${r.id}`, { method: 'PATCH', body }); await refresh() } catch (e) { err.value = (e as Error).message }
}
async function remove() {
  if (!del.value) return
  try { await adminFetch(`/api/admin/comments/${del.value.id}`, { method: 'DELETE' }); del.value = null; await refresh() } catch (e) { err.value = (e as Error).message; del.value = null }
}
</script>

<template>
  <div class="row">
    <div v-if="err" class="col-12"><div class="alert alert-danger" role="alert">{{ err }}</div></div>
    <div class="col-12 mb-3">
      <NuxtLink class="btn btn-sm btn-light" to="/admin/comments">الكل</NuxtLink>
      <NuxtLink class="btn btn-sm btn-warning" :to="{ path: '/admin/comments', query: { status: 'pending' } }">قيد المراجعة</NuxtLink>
      <NuxtLink class="btn btn-sm btn-success" :to="{ path: '/admin/comments', query: { status: 'approved' } }">مقبول</NuxtLink>
      <NuxtLink class="btn btn-sm btn-danger" :to="{ path: '/admin/comments', query: { status: 'rejected' } }">مرفوض</NuxtLink>
    </div>
    <div class="col-12 mb-30">
      <AdminDataTable :columns="columns" :rows="data?.items" :loading="pending" :error="errorText" :total="data?.total" :page="data?.page" :page-size="data?.pageSize" @retry="refresh()">
        <template #cell-user="{ row }">{{ row.profiles?.display_name }}</template>
        <template #cell-book="{ row }"><NuxtLink :to="`/admin/books/${row.book_id}/media`">{{ row.books?.title }}</NuxtLink></template>
        <template #cell-body="{ row }">{{ row.body.length > 90 ? `${row.body.slice(0, 90)}…` : row.body }}</template>
        <template #cell-status="{ row }"><span class="badge" :class="STATUS[row.status].c">{{ STATUS[row.status].l }}</span></template>
        <template #cell-visible="{ row }">{{ row.visible_to_public ? 'نعم' : 'لا' }}</template>
        <template #cell-created_at="{ row }">{{ fmtDate(row.created_at) }}</template>
        <template #cell-ops="{ row }">
          <button v-if="row.status !== 'approved'" class="btn btn-sm btn-success" type="button" title="قبول" @click="patch(row, { status: 'approved' })"><i class="fa fa-check" /></button>
          <button v-if="row.status !== 'rejected'" class="btn btn-sm btn-warning" type="button" title="رفض" @click="patch(row, { status: 'rejected' })"><i class="fa fa-ban" /></button>
          <button class="btn btn-sm btn-info" type="button" :title="row.visible_to_public ? 'إخفاء عن غير المشترين' : 'إظهار للجميع'" @click="patch(row, { visible_to_public: !row.visible_to_public })"><i class="fa" :class="row.visible_to_public ? 'fa-eye-slash' : 'fa-eye'" /></button>
          <button class="btn btn-sm btn-danger" type="button" title="حذف" @click="del = row"><i class="fa fa-trash" /></button>
        </template>
      </AdminDataTable>
    </div>
    <AdminModal :open="!!del" title="حذف التعليق" danger @close="del = null">
      <div class="form-group"><label>التعليق</label><textarea readonly class="form-control" rows="4" :value="del?.body" /></div>
      <template #footer><button class="btn ripple btn-danger" type="button" @click="remove">حذف</button></template>
    </AdminModal>
  </div>
</template>
