<script setup lang="ts">
// Shown on the book edit page for RECOVERED books only: where the record came from, what blocks publication, and the state of each linked file.
import { BOOK_PROVENANCE_LABEL, readinessReasonLabel } from '~~/shared/constants/recovery'

interface MediaRow { media_id: number; name: string; kind: string; migration_status: string; storage_provider: string; is_external: boolean; has_hash: boolean; validated: boolean }
defineProps<{
  provenance: string
  readiness: { eligible: boolean; reasons: string[] }
  legacyId: number | null
  legacyStatusRaw: string | null
  legacyCostRaw: string | null
  verifiedAt: string | null
  media: MediaRow[]
}>()

const MEDIA_STATUS: Record<string, string> = { pending: 'بانتظار النقل', staged: 'تم الاستلام وبانتظار الفحص', available: 'متاح', missing: 'الملف مفقود', rejected: 'مرفوض' }
const LEGACY_STATUS: Record<string, string> = { '0': 'غير مفعل', '1': 'مفعل', '2': 'قريباً' }
</script>

<template>
  <section class="recovery-panel card mb-30" aria-labelledby="recovery-title">
    <div class="card-body">
      <h5 id="recovery-title" class="card-title">
        <i class="fa fa-life-ring" aria-hidden="true" /> بيانات الاستعادة
        <span class="badge ml-2" :class="readiness.eligible ? 'badge-success' : 'badge-warning'">{{ readiness.eligible ? 'جاهز للنشر' : 'غير جاهز للنشر' }}</span>
      </h5>
      <dl class="recovery-facts">
        <div><dt>المصدر</dt><dd>{{ BOOK_PROVENANCE_LABEL[provenance as keyof typeof BOOK_PROVENANCE_LABEL] ?? provenance }}</dd></div>
        <div><dt>المعرّف القديم</dt><dd>{{ legacyId ?? '—' }}</dd></div>
        <div><dt>حالة النشر الأصلية</dt><dd>{{ legacyStatusRaw === null ? 'غير معروفة' : (LEGACY_STATUS[legacyStatusRaw] ?? legacyStatusRaw) }}</dd></div>
        <div><dt>السعر الأصلي (كما ورد)</dt><dd><bdi>{{ legacyCostRaw ?? '—' }}</bdi></dd></div>
        <div><dt>اعتماد المصدر</dt><dd>{{ verifiedAt ? `تم الاعتماد ${verifiedAt.slice(0, 10)}` : 'لم يُعتمد بعد' }}</dd></div>
      </dl>

      <div v-if="!readiness.eligible" class="alert alert-warning" role="status">
        <strong>لا يمكن نشر هذا الكتاب بعد:</strong>
        <ul class="mb-0 pr-3">
          <li v-for="r in readiness.reasons" :key="r">{{ readinessReasonLabel(r) }}</li>
        </ul>
      </div>
      <p v-else class="text-success mb-3">جميع شروط النشر مستوفاة. يمكن تفعيل الكتاب. (الدفع المباشر يبقى مغلقاً حتى تقرر ذلك صراحة.)</p>

      <h6>الملفات المرتبطة ({{ media.length }})</h6>
      <p v-if="!media.length" class="text-muted mb-0">لا توجد ملفات مرتبطة بهذا الكتاب.</p>
      <div v-else class="table-responsive">
        <table class="table table-sm mb-0">
          <thead><tr><th>الاسم</th><th>الحالة</th><th>التحقق</th></tr></thead>
          <tbody>
            <tr v-for="m in media" :key="m.media_id">
              <td>{{ m.name }}</td>
              <td>{{ MEDIA_STATUS[m.migration_status] ?? m.migration_status }}</td>
              <td><span class="badge" :class="m.validated ? 'badge-success' : 'badge-danger'">{{ m.validated ? 'تم التحقق' : 'لم يتم التحقق' }}</span></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>
</template>

<style scoped>
.recovery-facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 0.5rem 1.25rem; margin: 0 0 1rem; }
.recovery-facts dt { font-weight: 600; font-size: 0.85em; color: #6c757d; }
.recovery-facts dd { margin: 0; overflow-wrap: anywhere; }
</style>
