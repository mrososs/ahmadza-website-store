<script setup lang="ts">
// A recovered book that is still under review. It looks like a catalogue card but is deliberately not a product: no link to a book page, no price, no cart, no download.
// Every unknown is said to be unknown; nothing is guessed. Fields come from the whitelist in shared/utils/recoveredPreview.ts.
import type { RecoveredPreviewItem } from '~~/shared/utils/recoveredPreview'

const props = defineProps<{ item: RecoveredPreviewItem }>()
const size = computed(() => (props.item.size_bytes ? `${(props.item.size_bytes / 1048576).toFixed(1)} م.ب` : null))
</script>

<template>
  <div class="col-xl-3 col-lg-4 col-6">
    <article class="book_block block recovered-card" :aria-label="item.title">
      <div class="item">
        <span class="type_book recovered-badge">قيد المراجعة</span>
        <div class="img-block is-placeholder">
          <CoverImage class="img-fluid" loading="lazy" :path="null" :alt="item.title" />
        </div>
        <div class="info"><h3 class="name">{{ item.title }}</h3></div>
      </div>
      <div class="under">
        <p class="recovered-line"><span class="cost recovered-unknown">السعر غير محدد</span></p>
        <p class="recovered-line recovered-unknown">المؤلف غير محدد</p>
        <details class="recovered-details">
          <summary>تفاصيل المراجعة</summary>
          <dl>
            <dt>الحالة</dt><dd>قيد المراجعة، لم يُعتمد للنشر</dd>
            <dt>الأقسام</dt><dd>غير محددة</dd>
            <dt v-if="item.pages">عدد الصفحات (من الملف)</dt><dd v-if="item.pages">{{ item.pages }}</dd>
            <dt v-if="size">حجم الملف</dt><dd v-if="size">{{ size }}</dd>
            <dt v-if="item.original_name">الملف الأصلي</dt><dd v-if="item.original_name" dir="auto">{{ item.original_name }}</dd>
            <dt>بصمة الملف</dt><dd dir="ltr" class="recovered-hash">{{ item.fingerprint }}…</dd>
            <dt>فحص الملف</dt><dd>سليم، لم يُعثر على محتوى نشط</dd>
          </dl>
          <p class="recovered-note">العنوان مأخوذ من الملف المستعاد ولم يُطابق بعد مع سجل الكتالوج الأصلي. لا يمكن شراء هذا الكتاب أو تنزيله في المعاينة.</p>
        </details>
      </div>
    </article>
  </div>
</template>

<style scoped>
.recovered-badge { background: #b45309; color: #fff; }
.recovered-line { margin: 0 0 .25rem; font-size: .9rem; }
.recovered-unknown { color: #6b7280; }
.recovered-details { margin-top: .4rem; font-size: .85rem; text-align: right; }
.recovered-details summary { cursor: pointer; color: #1d4ed8; }
.recovered-details dl { margin: .5rem 0 0; display: grid; grid-template-columns: auto 1fr; gap: .15rem .6rem; }
.recovered-details dt { font-weight: 600; color: #374151; }
.recovered-details dd { margin: 0; overflow-wrap: anywhere; }
.recovered-hash { font-family: ui-monospace, monospace; }
.recovered-note { margin: .5rem 0 0; color: #6b7280; font-size: .8rem; }
</style>
