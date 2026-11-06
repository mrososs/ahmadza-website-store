/** Why a recovered book is still a draft. Codes come from public.book_readiness_row(); the labels are what admins read. */
export const READINESS_REASON_LABEL: Record<string, string> = {
  missing_legacy_id: 'لا يوجد معرّف قديم للكتاب',
  source_not_verified: 'المصدر لم يُعتمد كبيانات قديمة أصلية بعد',
  legacy_status_unknown: 'حالة النشر الأصلية غير معروفة',
  legacy_status_not_publishable: 'حالة النشر الأصلية لا تسمح بالنشر',
  missing_title: 'العنوان مفقود',
  price_missing: 'السعر الأصلي مفقود',
  price_unparsable_or_zero: 'السعر الأصلي غير صالح أو صفر',
  free_book_with_price: 'كتاب مجاني له سعر',
  no_validated_media: 'لا يوجد ملف مرتبط تم التحقق منه',
  missing_recovery_evidence: 'لا توجد أدلة مسجّلة لهوية الكتاب',
  book_not_found: 'الكتاب غير موجود',
}

export const readinessReasonLabel = (code: string) => READINESS_REASON_LABEL[code] ?? code

export const BOOK_PROVENANCE_LABEL = { admin: 'أُنشئ يدوياً', legacy: 'مستعاد من النظام القديم', recovered_media: 'مسودة من ملف أصلي (تحتاج مراجعة)', demo: 'بيانات تجريبية' } as const

/** Catalogue workflow, computed by the database (books_readiness.workflow_status). */
export const WORKFLOW_STATUSES = ['all', 'draft', 'needs_review', 'missing_media', 'ready', 'published', 'archived'] as const
export const WORKFLOW_LABEL: Record<(typeof WORKFLOW_STATUSES)[number], string> = {
  all: 'كل الحالات', draft: 'مسودة', needs_review: 'تحتاج مراجعة', missing_media: 'ملفات ناقصة', ready: 'جاهز للنشر', published: 'منشور', archived: 'مؤرشف',
}
export const WORKFLOW_BADGE: Record<string, string> = { draft: 'badge-secondary', needs_review: 'badge-warning', missing_media: 'badge-danger', ready: 'badge-info', published: 'badge-success', archived: 'badge-secondary' }

export const RECOVERY_LIST_FILTERS = ['all', 'recovered', 'not_ready', 'ready', 'missing_media'] as const
export const RECOVERY_LIST_FILTER_LABEL: Record<(typeof RECOVERY_LIST_FILTERS)[number], string> = {
  all: 'الكل', recovered: 'مستعاد', not_ready: 'غير جاهز للنشر', ready: 'جاهز للنشر', missing_media: 'ملفات ناقصة',
}

/** Exact sentence an admin must type to mark a recovered import run as verified genuine legacy data. */
export const RECOVERY_VERIFY_PHRASE = 'أؤكد أن هذه البيانات أصلية'
