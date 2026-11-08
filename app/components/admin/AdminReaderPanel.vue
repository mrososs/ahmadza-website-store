<script setup lang="ts">
// Book edit page: can this book be read, and is anything about its files unsafe? (server assessment, no storage paths)
import { READER_ISSUE_LABEL, type ReaderIssue } from '~~/shared/utils/readerReadiness'

const props = defineProps<{ bookId: number }>()
interface Status { kind: string; status: string; classification: 'free' | 'paid' | 'unclassified'; fullPdf: { count: number; available: number }; previewFiles: number; publicFullPdf: boolean; issues: ReaderIssue[] }
const status = ref<Status | null>(null)
const failed = ref(false)
try { status.value = await adminFetch<Status>(`/api/admin/books/${props.bookId}/reader-status`) } catch { failed.value = true }
const CLASS_LABEL = { free: 'مجاني (محدد صراحةً)', paid: 'مدفوع', unclassified: 'غير مصنف (لا يُعامل كمجاني)' } as const
</script>

<template>
  <div v-if="status" class="alert" :class="status.issues.length ? 'alert-warning' : 'alert-success'" role="note" data-test="reader-panel">
    <strong>القراءة والتسليم الآمن</strong>
    <ul class="mb-1 mt-1 pr-3">
      <li>التصنيف: {{ CLASS_LABEL[status.classification] }}</li>
      <li>ملف الكتاب (PDF): {{ status.fullPdf.available }} جاهز من {{ status.fullPdf.count }} — القارئ {{ status.fullPdf.available ? 'متاح' : 'غير متاح بعد' }}</li>
      <li>ملفات النبذة العامة: {{ status.previewFiles }}</li>
    </ul>
    <ul v-if="status.issues.length" class="mb-0 pr-3"><li v-for="i in status.issues" :key="i">{{ READER_ISSUE_LABEL[i] }}</li></ul>
    <p v-else class="mb-0">لا توجد ملاحظات.</p>
  </div>
  <div v-else-if="failed" class="alert alert-secondary" role="note">تعذر قراءة حالة القارئ.</div>
</template>
