<script setup lang="ts">
// resources/views/front/request-book.blade.php — contributor submission. Files are validated again on the server by
// magic bytes and stored in the PRIVATE bucket; the IBAN / Ministry documents are visible to the owner and admins only.
import { CONTRIBUTOR_LIMITS } from '~~/shared/constants/affiliate'
import { contributorFormSchema } from '~~/shared/schemas/affiliate'

definePageMeta({ middleware: ['auth'] })

const form = reactive({ name: '', type: 'paid', cost: '0.00', iban: '', whatsapp: '', deal: 'share', about: '', maker: '', agree: false })
const files = reactive<{ iban_file: File | null; ministry_file: File | null; cover: File | null; book: File | null }>({ iban_file: null, ministry_file: null, cover: null, book: null })
const errors = ref<Record<string, string>>({})
const failure = ref('')
const success = ref('')
const busy = ref(false)
const termsPage = ref('/p/terms')

const typeOptions = [{ value: 'paid', label: 'مدفوع' }, { value: 'free', label: 'مجانى' }]
const dealOptions = [{ value: 'share', label: 'المشاركة بنسبة' }, { value: 'rent', label: 'استئجار مساحة' }]
const mb = (n: number) => (n / 1024 / 1024).toFixed(2)

function validate(): boolean {
  const r = contributorFormSchema.safeParse({ ...form, agree: form.agree ? '1' : '' })
  const e: Record<string, string> = r.success ? {} : Object.fromEntries(r.error.issues.map((i) => [String(i.path[0]), i.message]).reverse())
  if (!files.book) e.book = 'ملف الكتاب مطلوب'
  else if (files.book.size > CONTRIBUTOR_LIMITS.bookBytes) e.book = 'حجم الكتاب أكبر من الحد المسموح'
  if (!files.ministry_file) e.ministry_file = 'فسح وزارة الاعلام مطلوب'
  for (const k of ['iban_file', 'ministry_file', 'cover'] as const) {
    if (files[k] && files[k]!.size > CONTRIBUTOR_LIMITS.otherBytes) e[k] = 'الحجم أكبر من الحد المسموح'
  }
  errors.value = e
  return Object.keys(e).length === 0
}

async function submit() {
  failure.value = ''; success.value = ''
  if (!validate()) return
  const fd = new FormData()
  for (const [k, v] of Object.entries(form)) fd.append(k, typeof v === 'boolean' ? (v ? '1' : '') : String(v))
  for (const [k, f] of Object.entries(files)) if (f) fd.append(k, f)
  busy.value = true
  try {
    await $fetch('/api/contributor/requests', { method: 'POST', body: fd })
    success.value = 'تم إرسال الطلب وسيتم مراجعته من الإدارة.'
    await navigateTo('/user-book')
  } catch (e) { failure.value = partnerErrorMessage(e) } finally { busy.value = false }
}
</script>

<template>
  <div>
    <PageHeading title="طلب إضافة كتاب" />
    <div class="row justify-content-center">
      <div class="col-lg-12">
        <div v-if="failure" class="alert alert-danger" role="alert">{{ failure }}</div>
        <div v-if="success" class="alert alert-success" role="status">{{ success }}</div>
        <form id="request_book" class="wp_form" enctype="multipart/form-data" novalidate @submit.prevent="submit">
          <div class="row">
            <div class="col-12"><p class="subtitle_form"><span>1</span> البيانات</p></div>
            <div class="col-md-6">
              <div class="form-group">
                <label for="rb-name">إسم الكتاب <span class="required_mark">*</span></label>
                <input id="rb-name" v-model="form.name" placeholder="إسم الكتاب" class="form-control" :class="{ 'is-invalid': errors.name }" name="name">
                <span v-if="errors.name" class="invalid-feedback d-block">{{ errors.name }}</span>
              </div>
            </div>
            <div class="col-md-3">
              <div class="form-group">
                <label>نوع الكتاب <span class="required_mark">*</span></label>
                <SelectPicker v-model="form.type" name="type" title="أختر نوع الكتاب" :options="typeOptions" />
              </div>
            </div>
            <div class="col-md-3">
              <div class="form-group">
                <label for="rb-cost">سعر الكتاب بالدولار <span class="required_mark">*</span></label>
                <input id="rb-cost" v-model="form.cost" inputmode="decimal" :disabled="form.type === 'free'" name="cost" class="form-control" :class="{ 'is-invalid': errors.cost }" placeholder="التكلفة">
                <span v-if="errors.cost" class="invalid-feedback d-block">{{ errors.cost }}</span>
              </div>
            </div>
            <div class="col-md-6">
              <div class="form-group">
                <label for="rb-iban">IBAN <span class="required_mark">*</span></label>
                <input id="rb-iban" v-model="form.iban" placeholder="رقم الـ IBAN" class="form-control" :class="{ 'is-invalid': errors.iban }" name="iban" dir="ltr">
                <span v-if="errors.iban" class="invalid-feedback d-block">{{ errors.iban }}</span>
              </div>
            </div>
            <div class="col-md-3">
              <label for="rb-wa">رقم الواتساب <span class="required_mark">*</span></label>
              <input id="rb-wa" v-model="form.whatsapp" class="form-control" :class="{ 'is-invalid': errors.whatsapp }" name="whatsapp" dir="ltr" inputmode="tel">
              <span v-if="errors.whatsapp" class="invalid-feedback d-block">{{ errors.whatsapp }}</span>
            </div>
            <div class="col-md-3">
              <div class="form-group">
                <label>نوع الإتفاقية <span class="required_mark">*</span></label>
                <SelectPicker v-model="form.deal" name="deal" title="أختر نوع الإتفاقية" :options="dealOptions" />
              </div>
            </div>
            <div class="col-md-6">
              <div class="form-group">
                <label for="rb-about">حول الكتاب <span class="required_mark">*</span></label>
                <textarea id="rb-about" v-model="form.about" name="about" class="form-control" :class="{ 'is-invalid': errors.about }" placeholder="أكتب عن الكتاب" />
                <span v-if="errors.about" class="invalid-feedback d-block">{{ errors.about }}</span>
              </div>
            </div>
            <div class="col-md-6">
              <div class="form-group">
                <label for="rb-maker">نبذة عن المؤلف <span class="required_mark">*</span></label>
                <textarea id="rb-maker" v-model="form.maker" name="maker" class="form-control" :class="{ 'is-invalid': errors.maker }" placeholder="أكتب نبذة عن المؤلف" />
                <span v-if="errors.maker" class="invalid-feedback d-block">{{ errors.maker }}</span>
              </div>
            </div>
            <div class="col-12"><p class="subtitle_form"><span>2</span> المرفقات</p></div>
            <div class="col-md-6">
              <div class="form-group">
                <label>ًصورة الـ IBAN من البنك<span style="color: red"> ( pdf,jpg,png,webp ) </span> &amp;&amp; أقصى حجم {{ mb(CONTRIBUTOR_LIMITS.otherBytes) }} ميجا</label>
                <FileDrop v-model="files.iban_file" name="iban_file" accept=".pdf,.jpg,.jpeg,.png,.webp" :height="50" />
                <span v-if="errors.iban_file" class="invalid-feedback d-block">{{ errors.iban_file }}</span>
              </div>
            </div>
            <div class="col-md-6">
              <div class="form-group">
                <label>فسح وزارة الاعلام<span style="color: red"> ( pdf,jpg,png,webp ) </span> &amp;&amp; أقصى حجم {{ mb(CONTRIBUTOR_LIMITS.otherBytes) }} ميجا <span class="required_mark">*</span></label>
                <FileDrop v-model="files.ministry_file" name="ministry_file" accept=".pdf,.jpg,.jpeg,.png,.webp" :height="50" />
                <span v-if="errors.ministry_file" class="invalid-feedback d-block">{{ errors.ministry_file }}</span>
              </div>
            </div>
            <div class="col-md-6">
              <div class="form-group">
                <label>غلاف الكتاب<span style="color: red"> ( png,jpg,jpeg,webp ) </span> &amp;&amp; أقصى حجم {{ mb(CONTRIBUTOR_LIMITS.otherBytes) }} ميجا - 952*635 px</label>
                <FileDrop v-model="files.cover" name="cover" accept=".jpg,.jpeg,.png,.webp" :height="50" />
                <span v-if="errors.cover" class="invalid-feedback d-block">{{ errors.cover }}</span>
              </div>
            </div>
            <div class="col-md-6">
              <div class="form-group">
                <label>الكتاب<span style="color: red"> ( pdf ) </span> &amp;&amp; أقصى حجم {{ mb(CONTRIBUTOR_LIMITS.bookBytes) }} ميجا <span class="required_mark">*</span></label>
                <FileDrop v-model="files.book" name="book" accept=".pdf" :height="50" />
                <span v-if="errors.book" class="invalid-feedback d-block">{{ errors.book }}</span>
              </div>
            </div>
            <div class="col-12">
              <div class="form-check">
                <label class="form-check-label" style="font-size: 12px">
                  <input id="agree_deal_request_book_input" v-model="form.agree" type="checkbox" class="form-check-input">
                  نعم, موافق على <NuxtLink target="_blank" :to="termsPage">اتفاقية النشر على المنصّة</NuxtLink>
                </label>
                <span v-if="errors.agree" class="invalid-feedback d-block">{{ errors.agree }}</span>
              </div>
            </div>
            <div class="col-12">
              <div class="form-group text-right">
                <button type="submit" class="wp_btn" :disabled="busy">{{ busy ? 'جاري الإرسال…' : 'إرسال الطلب' }}</button>
              </div>
            </div>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>
