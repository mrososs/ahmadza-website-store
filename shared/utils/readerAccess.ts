// Who may open the full-text reader of a book. Pure decision, shared by the server route (authority) and the tests.
// A missing price is NEVER a free book: "free" is only the explicit book kind, and only while published.
export type ReaderVia = 'free' | 'owner' | 'admin'
export type ReaderState = 'granted' | 'login_required' | 'purchase_required' | 'unavailable' | 'not_found'

export interface ReaderFacts {
  status: string
  kind: string
  isAdmin: boolean
  signedIn: boolean
  hasEntitlement: boolean
  /** an available PDF exists for the book (decided by the caller from book_media) */
  fileAvailable: boolean
}

export function decideReaderAccess(f: ReaderFacts): { state: ReaderState; via: ReaderVia | null } {
  const published = f.status === 'published'
  const visible = published || f.status === 'coming_soon'
  if (!visible && !f.isAdmin) return { state: 'not_found', via: null }
  const via: ReaderVia | null = f.isAdmin ? 'admin' : f.hasEntitlement ? 'owner' : f.kind === 'free' && published ? 'free' : null
  if (!via) return { state: f.signedIn ? 'purchase_required' : 'login_required', via: null }
  // availability is only revealed to someone who is allowed to read: an outsider learns nothing about the file
  return f.fileAvailable ? { state: 'granted', via } : { state: 'unavailable', via }
}

export const PURCHASE_REQUIRED_MESSAGE = 'لقراءة الكتاب كاملًا، يرجى شراء الكتاب أولًا.'
export const PURCHASE_BUTTON_LABEL = 'شراء الكتاب'
