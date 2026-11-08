// What an administrator needs to know before a book can be read / sold: explicit classification, price validity, PDF availability and
// whether a FULL PDF would be handed out publicly. Pure, shared by the admin endpoint, the publish guard and the tests.
export interface ReadinessMedia { id: number; extension: string | null; visibility: 'preview' | 'after_purchase'; migration_status: string; page_count: number; sha256: string | null }
export interface ReadinessBook { kind: string; status: string; price_amount: number | string | null }

export type ReaderIssue = 'price_missing' | 'free_with_price' | 'no_pdf' | 'pdf_not_available' | 'public_full_pdf'

export interface ReaderAssessment {
  /** 'unclassified' = marked paid but without a valid price: nothing may treat it as free OR sell it */
  classification: 'free' | 'paid' | 'unclassified'
  fullPdf: { count: number; available: number }
  previewFiles: number
  publicFullPdf: boolean
  issues: ReaderIssue[]
}

const isPdf = (m: ReadinessMedia) => (m.extension ?? '').toLowerCase() === 'pdf'
const num = (v: number | string | null) => (v === null || v === '' ? null : Number(v))

export function assessReader(book: ReadinessBook, media: ReadinessMedia[]): ReaderAssessment {
  const full = media.filter((m) => m.visibility === 'after_purchase' && isPdf(m))
  const previews = media.filter((m) => m.visibility === 'preview' && isPdf(m))
  const price = num(book.price_amount)
  const issues: ReaderIssue[] = []
  let classification: ReaderAssessment['classification']
  if (book.kind === 'free') { classification = 'free'; if (price !== null && price !== 0) issues.push('free_with_price') }
  else if (price !== null && Number.isFinite(price) && price > 0) classification = 'paid'
  else { classification = 'unclassified'; issues.push('price_missing') }
  const available = full.filter((m) => m.migration_status === 'available').length
  if (!full.length) issues.push('no_pdf')
  else if (!available) issues.push('pdf_not_available')
  // a PDF visible to everyone that is the same file as (or at least as long as) the protected one is the paid book given away
  const publicFullPdf = previews.some((p) => full.some((f) => (!!p.sha256 && p.sha256 === f.sha256) || (p.page_count > 0 && f.page_count > 0 && p.page_count >= f.page_count)))
  if (publicFullPdf && book.kind !== 'free') issues.push('public_full_pdf')
  return { classification, fullPdf: { count: full.length, available }, previewFiles: previews.length, publicFullPdf: publicFullPdf && book.kind !== 'free', issues }
}

export const READER_ISSUE_LABEL: Record<ReaderIssue, string> = {
  price_missing: 'السعر غير محدد: صنّف الكتاب مجانياً صراحةً أو أدخل سعراً أكبر من صفر',
  free_with_price: 'كتاب مجاني ولديه سعر: صحّح أحدهما',
  no_pdf: 'لا يوجد ملف PDF للكتاب',
  pdf_not_available: 'ملف PDF موجود لكنه غير جاهز للتسليم الآمن بعد',
  public_full_pdf: 'تحذير: ملف عام (نبذة) مطابق للكتاب الكامل أو بطوله: لن يُنشر الكتاب المدفوع قبل إزالته',
}
