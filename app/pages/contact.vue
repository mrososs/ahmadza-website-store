<script setup lang="ts">
// Port of resources/views/front/contact.blade.php. Submits to POST /api/contact (validated + rate limited server-side).
import { contactSchema } from '~~/shared/schemas'

const subjects = [
  { value: 'note', label: 'ملاحظة' }, { value: 'request', label: 'طلب' }, { value: 'report', label: 'إبلاغ' }, { value: 'other', label: 'أخرى' },
]
const route = useRoute()
const form = reactive({ name: '', email: '', subject: typeof route.query.subject === 'string' ? route.query.subject : '', message: '', website: '' })
const errors = ref<Record<string, string>>({})
const busy = ref(false)
const done = ref(false)
const failure = ref('')

async function submit() {
  failure.value = ''
  const parsed = contactSchema.safeParse(form)
  if (!parsed.success) {
    errors.value = Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message]))
    return
  }
  errors.value = {}
  busy.value = true
  try {
    await $fetch('/api/contact', { method: 'POST', body: { ...parsed.data, website: form.website } })
    done.value = true
  } catch (e) {
    failure.value = (e as { statusCode?: number }).statusCode === 429 ? 'طلبات كثيرة، حاول لاحقاً' : 'تعذر إرسال الرسالة، حاول مرة أخرى'
  } finally { busy.value = false }
}
</script>

<template>
  <div>
    <PageHeading title="تواصل معنا" />
    <section class="subscription_sec">
      <div class="register_sec">
        <div class="row justify-content-center">
          <div class="col-md-7">
            <div class="contact_sec">
              <div v-if="done" class="alert alert-success" role="status">تم إرسال رسالتك بنجاح، سنرد عليك قريباً.</div>
              <form v-else class="wp_form" novalidate @submit.prevent="submit">
                <div v-if="failure" class="alert alert-danger" role="alert">{{ failure }}</div>
                <!-- honeypot: hidden from people, bots fill it -->
                <input v-model="form.website" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true" style="position: absolute; width: 1px; height: 1px; opacity: 0; overflow: hidden; pointer-events: none">
                <div class="form-group">
                  <label for="c-name">أسم المرسل <strong style="color: red">*</strong></label>
                  <input id="c-name" v-model="form.name" name="name" class="form-control" placeholder="أسم المرسل" autocomplete="name">
                  <small v-if="errors.name" class="text-danger">{{ errors.name }}</small>
                </div>
                <div class="form-group">
                  <label for="c-email">البريد الالكترونى <strong style="color: red">*</strong></label>
                  <input id="c-email" v-model="form.email" name="email" type="email" class="form-control" placeholder="البريد الالكترونى" autocomplete="email">
                  <small v-if="errors.email" class="text-danger">{{ errors.email }}</small>
                </div>
                <div class="form-group">
                  <label>الموضوع <strong style="color: red">*</strong></label>
                  <SelectPicker v-model="form.subject" name="subject" title="أختر نوع الموضوع" :options="subjects" />
                  <small v-if="errors.subject" class="text-danger">اختر نوع الموضوع</small>
                </div>
                <div class="form-group">
                  <label for="c-msg">الرسالة <strong style="color: red">*</strong></label>
                  <textarea id="c-msg" v-model="form.message" class="form-control" placeholder="أكتب الرسالة هنا ..." name="message" />
                  <small v-if="errors.message" class="text-danger">{{ errors.message }}</small>
                </div>
                <div class="text-center">
                  <button class="wp_btn btn-block" type="submit" :disabled="busy">{{ busy ? 'جاري الإرسال…' : 'أرسل الان' }}</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
