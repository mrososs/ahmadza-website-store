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
  evidence?: {
    sha256?: string; byte_size?: number; pdf?: { title?: string; author?: string; pages?: number }
    source_file?: { original_name?: string; legacy_path?: string }
    checks?: { malware_scan?: string; hash_verified?: boolean; size_verified?: boolean; encrypted?: boolean; active_content?: string }
    uncertain?: Record<string, string>
    hosted_import?: { at?: string; file_uploaded?: boolean }
  } | null
  canVerify?: boolean
  canReject?: boolean
  cover?: { current?: { provenance?: string; path?: string; review?: string; confidence?: string; reason?: string; class?: string } | null; candidates?: Array<{ id: string; provenance: string; confidence?: string; class?: string; reason?: string; status: string }> } | null
  previews?: Record<string, string>
  duplicateTitleIds?: number[]
  busy?: boolean
}>()
const emit = defineEmits<{ verify: []; reject: []; 'cover-decision': [candidate: string, decision: 'approve' | 'reject'] }>()
const { publicUrl } = useMediaUrl()

// Where a cover came from, in plain Arabic. A generated cover is NEVER presented as the original.
const COVER_SOURCE: Record<string, string> = {
  generated_from_pdf: 'صورة الصفحة الأولى من ملف الكتاب (مُولَّدة، وليست الغلاف الأصلي)',
  original_cover: 'غلاف أصلي مُسترجع من مخزن الموقع القديم',
  admin_upload: 'مرفوع من المسؤول',
}
// What the measurement means, in Arabic (the measured English sentence stays as a tooltip). Shown for proposed covers and for a generated current cover.
const COVER_CLASS: Record<string, string> = {
  cover_like: 'الصفحة الأولى صورة واحدة كبيرة بلا نص تقريباً: تبدو غلافاً',
  uncertain: 'قد تكون غلافاً لكن الدليل غير حاسم: راجعها بعينك',
  text_page: 'الأرجح أنها صفحة نصية أو صفحة عنوان وليست غلافاً',
}
const coverNote = (c: { class?: string; confidence?: string }) => COVER_CLASS[c.class ?? ''] ?? (c.confidence === 'high' ? COVER_CLASS.cover_like : '')
const COVER_REVIEW: Record<string, string> = { unreviewed: 'لم يراجعها مسؤول بعد', approved_by_admin: 'اعتمدها مسؤول' }
const CANDIDATE_STATUS: Record<string, string> = { pending: 'بانتظار قرارك', approved: 'معتمد', rejected: 'مرفوض', superseded: 'استُبدل بقرار آخر' }
const CONFIDENCE: Record<string, string> = { high: 'ثقة عالية', medium: 'ثقة متوسطة', low: 'ثقة منخفضة' }

// What the recovery could NOT establish, in plain Arabic (the stored English notes are the evidence; these are what the reviewer reads).
const UNKNOWN_LABEL: Record<string, string> = {
  title: 'العنوان مأخوذ من الملف ولم يُطابق مع سجل أصلي',
  author: 'المؤلف غير مُسند (الاسم في بيانات الملف غير موثق)',
  categories: 'الأقسام غير محددة',
  price: 'السعر مجهول ولم يُستنتج (القيمة 0 مؤقتة ولا يمكن النشر بها)',
  kind: 'النوع (مجاني أو مدفوع) مجهول، والقيمة الحالية مؤقتة',
  publication_status: 'لا يوجد سجل أصلي يبين هل نُشر الكتاب سابقاً',
}
const formatSize = (b?: number) => (b ? `${(b / 1048576).toFixed(2)} م.ب` : null)

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
        <template v-if="evidence">
          <div v-if="evidence.pdf?.title"><dt>العنوان في الملف الأصلي</dt><dd>{{ evidence.pdf.title }}</dd></div>
          <div v-if="evidence.pdf?.author"><dt>المؤلف في الملف الأصلي</dt><dd>{{ evidence.pdf.author }}</dd></div>
          <div v-if="evidence.sha256"><dt>بصمة الملف (SHA-256)</dt><dd dir="ltr" class="text-right"><code>{{ evidence.sha256.slice(0, 16) }}…</code></dd></div>
          <div v-if="evidence.source_file?.original_name" data-testid="evidence-original-name"><dt>اسم الملف الأصلي</dt><dd><bdi dir="ltr">{{ evidence.source_file.original_name }}</bdi></dd></div>
          <div v-if="evidence.source_file?.legacy_path"><dt>المسار الأصلي</dt><dd dir="ltr" class="text-right"><code>{{ evidence.source_file.legacy_path }}</code></dd></div>
          <div v-if="evidence.pdf?.pages"><dt>عدد الصفحات (من الملف)</dt><dd>{{ evidence.pdf.pages }}</dd></div>
          <div v-if="formatSize(evidence.byte_size)"><dt>حجم الملف</dt><dd>{{ formatSize(evidence.byte_size) }}</dd></div>
          <div v-if="evidence.checks"><dt>فحص الملف عند الاستعادة</dt><dd>{{ evidence.checks.malware_scan === 'clean' ? 'سليم' : 'غير مؤكد' }}، {{ evidence.checks.active_content === 'none found' ? 'لا محتوى نشط' : 'محتوى نشط' }}، {{ evidence.checks.hash_verified ? 'البصمة مطابقة' : 'البصمة غير مؤكدة' }}</dd></div>
          <div v-if="evidence.checks" data-testid="evidence-support"><dt>ما تدعمه الأدلة</dt><dd>الملف نفسه موثق (بصمة وفحص). العنوان مأخوذ من الملف. المؤلف والأقسام والسعر بلا أي دليل.</dd></div>
          <div v-if="evidence.hosted_import?.at"><dt>الاستيراد إلى الموقع</dt><dd>{{ evidence.hosted_import.at.slice(0, 10) }}<template v-if="evidence.hosted_import.file_uploaded === false"> — لم يُرفع ملف PDF بعد</template></dd></div>
        </template>
      </dl>
      <div v-if="duplicateTitleIds?.length" class="alert alert-warning" role="status" data-testid="duplicate-warning">
        <strong>تنبيه:</strong> يوجد {{ duplicateTitleIds.length }} كتاب آخر بنفس العنوان تماماً:
        <template v-for="(d, i) in duplicateTitleIds" :key="d"><NuxtLink :to="`/admin/books/${d}`">#{{ d }}</NuxtLink><span v-if="i < duplicateTitleIds.length - 1">، </span></template>.
        قد يكون إصداراً آخر وقد يكون تكراراً: لا يُدمج ولا يُحذف شيء تلقائياً، والقرار لك.
      </div>

      <div class="cover-block mb-3" data-testid="cover-block">
        <h6>الغلاف</h6>
        <div v-if="cover?.current?.path" class="d-flex align-items-start">
          <img :src="publicUrl(cover.current.path)" width="90" class="ml-3 border" alt="الغلاف الحالي" data-testid="cover-current">
          <div>
            <strong>{{ COVER_SOURCE[cover.current.provenance ?? ''] ?? cover.current.provenance }}</strong>
            <div class="text-muted small">{{ COVER_REVIEW[cover.current.review ?? ''] ?? '' }}<template v-if="cover.current.confidence"> · {{ CONFIDENCE[cover.current.confidence] ?? cover.current.confidence }}</template></div>
            <div v-if="coverNote(cover.current)" class="text-muted small" :title="cover.current.reason">{{ coverNote(cover.current) }}</div>
          </div>
        </div>
        <p v-else class="text-muted mb-2">لا يوجد غلاف معتمد: يظهر الغلاف الافتراضي في المعاينة.</p>
        <div v-if="cover?.candidates?.length" class="mt-2" data-testid="cover-candidates">
          <strong>أغلفة مقترحة</strong>
          <div v-for="c in cover.candidates" :key="c.id" class="d-flex align-items-start border-top pt-2 mt-2" :data-testid="`cover-candidate-${c.id}`">
            <img v-if="previews?.[c.id]" :src="previews[c.id]" width="90" class="ml-3 border" :alt="`صورة مقترحة ${c.id}`">
            <div class="flex-grow-1">
              <div>{{ COVER_SOURCE[c.provenance] ?? c.provenance }} · {{ CONFIDENCE[c.confidence ?? ''] ?? '' }}</div>
              <div v-if="coverNote(c)" class="text-muted small" :title="c.reason">{{ coverNote(c) }}</div>
              <div class="mt-1">
                <template v-if="c.status === 'pending'">
                  <button type="button" class="btn btn-sm btn-success" :disabled="busy" @click="emit('cover-decision', c.id, 'approve')">اعتماد كغلاف</button>
                  <button type="button" class="btn btn-sm btn-outline-secondary mr-2" :disabled="busy" @click="emit('cover-decision', c.id, 'reject')">رفض</button>
                </template>
                <span v-else class="badge badge-light">{{ CANDIDATE_STATUS[c.status] ?? c.status }}</span>
              </div>
            </div>
          </div>
        </div>
        <small class="text-muted d-block mt-2">اعتماد غلاف لا ينشر الكتاب ولا يغيّر سعره. لتغيير غلاف معتمد ارفع صورة جديدة من نموذج الكتاب.</small>
      </div>

      <div v-if="evidence?.uncertain && Object.keys(evidence.uncertain).length" class="alert alert-secondary" role="note" data-testid="evidence-unknowns">
        <strong>ما لا يزال مجهولاً (لم يُخمَّن):</strong>
        <ul class="mb-0 pr-3"><li v-for="k in Object.keys(evidence.uncertain)" :key="k">{{ UNKNOWN_LABEL[k] ?? k }}</li></ul>
      </div>
      <p v-if="canVerify && !verifiedAt" class="mb-3">
        <button type="button" class="btn btn-sm btn-primary" @click="emit('verify')">اعتماد هذا الكتاب بعد مراجعته</button>
        <button v-if="canReject" type="button" class="btn btn-sm btn-outline-danger mr-2" @click="emit('reject')">رفض هذا السجل</button>
        <small class="text-muted d-block">الاعتماد لا ينشر الكتاب. يلزم أيضاً سعر صالح وملف موثق. الرفض ينقل السجل إلى المهملات ويمكن استعادته.</small>
      </p>

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
