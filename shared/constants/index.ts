export const PAGE_SIZE = 20 // legacy ShowDataController: 20 books per page
export const ARTICLE_PAGE_SIZE = 12
export const AFFILIATE_COOKIE = 'aw_aff'
export const AFFILIATE_COOKIE_DAYS = 30
export const CART_STORAGE_KEY = 'aw_cart_v1'
export const MAX_CART_ITEMS = 50

export const BOOK_STATUS_LABEL = { draft: 'مسودة', published: 'منشور', coming_soon: 'قريباً', archived: 'مؤرشف' } as const
export const BOOK_KIND_LABEL = { paid: 'مدفوع', free: 'مجانى' } as const
export const MAKER_KIND_LABEL = { author: 'مؤلف', reader: 'قارئ', writer: 'كاتب' } as const
export const CONTACT_SUBJECTS = { note: 'ملاحظة', request: 'طلب', report: 'إبلاغ', other: 'أخرى' } as const
export const WITHDRAWAL_STATUS_LABEL = { pending: 'قيد المراجعة', paid: 'تم التحويل', rejected: 'مرفوض' } as const
export const CONTRIBUTOR_STATUS_LABEL = { pending: 'قيد المراجعة', approved: 'تمت الموافقة', declined: 'مرفوض' } as const
export const CONTRIBUTOR_DEAL_LABEL = { share: 'مشاركة أرباح', rent: 'إيجار' } as const

/** Magic-byte allow-list for uploads (content inspection, never the extension alone). */
export const ALLOWED_UPLOAD = {
  pdf: { mime: 'application/pdf', magic: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  png: { mime: 'image/png', magic: [0x89, 0x50, 0x4e, 0x47] },
  jpg: { mime: 'image/jpeg', magic: [0xff, 0xd8, 0xff] },
  webp: { mime: 'image/webp', magic: [0x52, 0x49, 0x46, 0x46] }, // RIFF....WEBP (checked further server-side)
} as const
