<script setup lang="ts">
// Development seed rows (is_demo = true) are clearly separable from real / imported data and removable here.
definePageMeta({ layout: 'admin', middleware: ['admin'] })
useAdminTitle('بيانات تجريبية')

const { data, error, refresh } = await useFetch<Record<'books' | 'articles' | 'pages' | 'makers' | 'categories', number>>('/api/admin/demo', { server: false, key: 'admin-demo' })
const LABELS = { books: 'كتب', categories: 'أقسام', makers: 'مؤلفون', articles: 'مقالات', pages: 'صفحات' } as const
const total = computed(() => Object.values(data.value ?? {}).reduce((s, n) => s + n, 0))
const confirmText = ref('')
const busy = ref(false)
const msg = reactive({ ok: '', err: '' })

async function purge() {
  msg.ok = ''; msg.err = ''; busy.value = true
  try {
    await adminFetch('/api/admin/demo', { method: 'DELETE', body: { confirm: confirmText.value } })
    msg.ok = 'تم حذف جميع البيانات التجريبية'
    confirmText.value = ''
    await refresh()
  } catch (e) { msg.err = (e as Error).message } finally { busy.value = false }
}
</script>

<template>
  <div class="row justify-content-center">
    <div class="col-lg-8 col-12">
      <div v-if="error" class="alert alert-danger" role="alert">{{ adminErrorMessage(error) }} <a href="#" @click.prevent="refresh()">إعادة المحاولة</a></div>
      <div v-if="msg.ok" class="alert alert-success" role="status">{{ msg.ok }}</div>
      <div v-if="msg.err" class="alert alert-danger" role="alert">{{ msg.err }}</div>
      <div class="card card-statistics">
        <div class="card-body">
          <p>هذه بيانات اختبار للتطوير المحلي فقط (ليست من أرشيف العميل). حذفها لا يمس أي بيانات حقيقية أو مستوردة.</p>
          <table class="table table-bordered">
            <tbody><tr v-for="(label, k) in LABELS" :key="k"><td>{{ label }}</td><td>{{ data?.[k] ?? '-' }}</td></tr></tbody>
          </table>
          <div class="form-group">
            <label for="demo-confirm">للتأكيد اكتب <code>DELETE-DEMO</code></label>
            <input id="demo-confirm" v-model="confirmText" class="form-control" dir="ltr" autocomplete="off">
          </div>
          <button class="btn btn-danger" type="button" :disabled="busy || confirmText !== 'DELETE-DEMO' || !total" @click="purge"><i class="fa fa-trash" /> حذف البيانات التجريبية ({{ total }})</button>
        </div>
      </div>
    </div>
  </div>
</template>
