<script setup lang="ts">
// resources/views/affiliate/admin/index.blade.php — affiliate list with ledger-derived balances.
definePageMeta({ layout: 'admin', middleware: ['admin'] })
useAdminTitle('المسوقين بالعمولة')
useHead({ style: [{ innerHTML: '.table th{text-align:center !important;}' }] })

interface Row { id: string; display_name: string; email: string; phone: string | null; status: 'active' | 'review' | 'banned'; created_at: string; earned: number; available: number; frozen: number }
const rows = ref<Row[]>([])
const loading = ref(true)
const error = ref('')
const selected = ref<Row | null>(null)
const newStatus = ref('active')
const msg = ref('')
const closeBtn = ref<HTMLButtonElement | null>(null)
const statusOptions = [{ value: 'review', label: 'تحت المراجعة' }, { value: 'active', label: 'مفعل' }, { value: 'banned', label: 'محظور' }]

async function load() {
  try { rows.value = await $fetch<Row[]>('/api/admin/affiliates') } catch (e) { error.value = partnerErrorMessage(e) } finally { loading.value = false }
}
onMounted(load)

function pick(r: Row) { selected.value = r; newStatus.value = r.status }
async function saveStatus() {
  if (!selected.value) return
  try {
    await $fetch(`/api/admin/affiliates/${selected.value.id}`, { method: 'PATCH', body: { status: newStatus.value } })
    msg.value = 'تم تحديث الحالة'
    closeBtn.value?.click()
    await load()
  } catch (e) { error.value = partnerErrorMessage(e) }
}
</script>

<template>
  <div>
    <div id="update_modal" class="modal main-model">
      <div class="modal-dialog modal-dialog-centered" role="document">
        <div class="modal-content modal-content-demo">
          <form @submit.prevent="saveStatus">
            <div class="modal-header"><h6 class="modal-title text-center">تغير حالة المستخدم</h6></div>
            <div class="modal-body">
              <div class="row">
                <div class="col-12">
                  <div class="form-group">
                    <label>الأسم الحقيقى</label>
                    <input :value="selected?.display_name" readonly class="form-control" placeholder="الأسم الحقيقى">
                  </div>
                  <div class="form-group">
                    <label>الحالة</label>
                    <SelectPicker v-model="newStatus" name="status" title="أختر الحالة" :options="statusOptions" />
                  </div>
                </div>
              </div>
            </div>
            <div class="modal-footer">
              <button class="btn ripple btn-success" type="submit">حفظ</button>
              <button ref="closeBtn" class="btn ripple btn-secondary" data-dismiss="modal" type="button">أغلاق</button>
            </div>
          </form>
        </div>
      </div>
    </div>

    <div class="row">
      <div class="col-12 text-right mb-3">
        <NuxtLink class="button" to="/admin/affiliates/create"><i class="fa fa-plus" /> أضافة جديد</NuxtLink>
      </div>
      <div class="col-12">
        <div v-if="msg" class="alert alert-success" role="status">{{ msg }}</div>
        <div v-if="error" class="alert alert-danger" role="alert">{{ error }}</div>
      </div>
      <div class="col-12 mb-30">
        <div class="card card-statistics h-100">
          <div class="card-body">
            <div v-if="loading" class="text-center p-4" role="status"><i class="fa fa-spinner fa-spin" /> جاري التحميل…</div>
            <div v-else class="table-responsive">
              <table class="table is-striped text-center w-100 data-table">
                <thead>
                  <tr>
                    <th class="wd-5p border-bottom-0">#</th>
                    <th class="wd-15p border-bottom-0">الأسم </th>
                    <th class="wd-15p border-bottom-0">البريد الإلكترونى</th>
                    <th class="wd-15p border-bottom-0">رقم الهاتف</th>
                    <th class="wd-10p border-bottom-0">الرصيد</th>
                    <th class="wd-10p border-bottom-0">الحالة</th>
                    <th class="wd-10p border-bottom-0">تاريخ التسجيل</th>
                    <th class="wd-10p border-bottom-0">عمليات</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-if="!rows.length"><td colspan="8">لا يوجد مسوقون</td></tr>
                  <tr v-for="(r, i) in rows" :key="r.id">
                    <td class="number_td">{{ i + 1 }}</td>
                    <td>{{ r.display_name }}</td>
                    <td>{{ r.email }}</td>
                    <td>{{ r.phone || '-' }}</td>
                    <td><bdi>{{ partnerMoney(r.available) }}</bdi></td>
                    <td><span class="badge" :class="ACCOUNT_STATUS_BADGE[r.status].cls">{{ ACCOUNT_STATUS_BADGE[r.status].label }}</span></td>
                    <td>{{ partnerDate(r.created_at) }}</td>
                    <td>
                      <div>
                        <button aria-expanded="false" aria-haspopup="true" class="btn ripple btn-sm btn-primary" data-toggle="dropdown" type="button">
                          عمليات <i class="fa fa-caret-down ml-1" />
                        </button>
                        <div class="dropdown-menu tx-13">
                          <NuxtLink class="dropdown-item btn btn-info" :to="`/admin/affiliates/${r.id}`"><i class="fa fa-eye" /> الملف الشخصى</NuxtLink>
                          <a class="dropdown-item update-btn" data-toggle="modal" href="#update_modal" @click="pick(r)"><i class="fa fa-edit" /> تغير حالة</a>
                        </div>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
