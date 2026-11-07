// Matching recovered ORIGINAL cover files to hosted books, by evidence and never by guesswork. Pure functions: no file, no network, no database.
//
// What the legacy Laravel code establishes (read from app/Http/Controllers, not assumed):
//  * A cover is saved by convertImage() as  product_cover/<time()><rand(1..999)><date('Ymdis')>.webp  when a book is created or a contributor request is approved, and as
//    product_cover/copy_<time()><date('Ymdis')>.<ext>  when a book is cloned. <time()> is the Unix time of that save.
//  * A product file is saved as  product_media/<site name>-<time()>.<ext>.
//  * An ordinary book gets its cover when it is CREATED and its PDF later, on a separate "contents" page: the two stamps differ by at least a page navigation.
//    Approving a contributor request copies the cover and the PDF inside ONE request: the two stamps agree to the second (cover first).
// So the evidence ladder is:
//   verified          cover and PDF stamps within 2 s, the cover not later than the PDF, and nothing else competes within that window: the documented same-request path.
//   candidate_strong  the cover is visually the book's own first page (perceptual hash), or the stamp is adjacent AND the picture agrees. A person still approves.
//   candidate         the cover is the unique, mutually nearest earlier cover within 48 h of the PDF (the ordinary create-then-add-contents flow). A person must look.
//   unmatched         anything else. A similar title is never evidence, and one image is never given to two books.
// Nothing here may publish anything: a match is only a proposal for the cover record. (Erasable TypeScript only, so Node can run it directly.)

export interface CoverFile { file: string; sha256: string; bytes: number }
export interface BookRef { id: number; title?: string; pdf_file: string | null }
export interface VisualHashes { covers?: Record<string, string>; pages?: Record<string, string> } // 64-bit dHash as 16 hex chars: covers by sha256, first pages by book id

export type Confidence = 'verified' | 'candidate_strong' | 'candidate' | 'unmatched'
export interface Match {
  cover_file: string; sha256: string; book_id: number | null; method: string | null; confidence: Confidence; review_required: boolean
  evidence: string[]; competing_book_ids: number[]
}

export interface ParsedCoverName { epoch: number; kind: 'upload' | 'copy'; consistent: boolean }

/** product_cover file name -> the stamp inside it, and whether the name is internally consistent (the Ymdis part agrees with the stamp's minutes and seconds). */
export function parseCoverName(file: string): ParsedCoverName | null {
  const base = file.split(/[\\/]/).pop() ?? ''
  const copy = /^copy_(\d{10})(\d{8})(\d{2})(\d{2})\.(?:webp|jpe?g|png)$/i.exec(base)
  const upload = /^(\d{10})(\d{1,3})(\d{8})(\d{2})(\d{2})\.(?:webp|jpe?g|png)$/i.exec(base)
  const m = copy ?? upload
  if (!m) return null
  const epoch = Number(m[1])
  const ymd = copy ? m[2]! : m[3]!
  const mm = Number(copy ? m[3] : m[4]), ss = Number(copy ? m[4] : m[5])
  const d = new Date(epoch * 1000)
  const dayDiff = Math.abs(Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(4, 6)) - 1, Number(ymd.slice(6, 8))) - Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())) / 86_400_000
  // the server's timezone shifts the hour (and the date by at most a day), never the seconds; a half-hour zone shifts the minutes by 30
  const minuteOk = mm === d.getUTCMinutes() || mm === (d.getUTCMinutes() + 30) % 60 || mm === (d.getUTCMinutes() + 45) % 60
  return { epoch, kind: copy ? 'copy' : 'upload', consistent: ss === d.getUTCSeconds() && minuteOk && dayDiff <= 1 && epoch > 1_262_304_000 && epoch < 2_000_000_000 }
}

/** product_media file name (or the path) -> the stamp inside it, or null. */
export function parsePdfEpoch(file: string | null): number | null {
  const m = /-(\d{10})\.[A-Za-z0-9]{2,5}$/.exec(file ?? '')
  return m ? Number(m[1]) : null
}

const hamming = (a: string, b: string): number => {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`), n = 0
  while (x) { n += Number(x & 1n); x >>= 1n }
  return n
}
const SAME_REQUEST_SECONDS = 2
const ORDINARY_WINDOW_SECONDS = 48 * 3600
const VISUAL_IDENTITY_BITS = 4 // a re-encoded smaller copy of the same picture differs by 0 to 1 bits; two different books were never closer than 7 in a sample of 40

export function matchCovers({ covers, books, hashes }: { covers: CoverFile[]; books: BookRef[]; hashes?: VisualHashes }): Match[] {
  // identical files (a clone copies its cover) are one image: it may be given to a book only when exactly one book is its unique match
  const groups = new Map<string, CoverFile[]>()
  for (const c of covers) groups.set(c.sha256, [...(groups.get(c.sha256) ?? []), c])
  const stamped = books.map((b) => ({ id: b.id, epoch: parsePdfEpoch(b.pdf_file) })).filter((b): b is { id: number; epoch: number } => b.epoch != null)
  const out: Match[] = []
  const taken = new Map<number, string>() // book id -> sha256 that claimed it with the strongest evidence so far

  const results = [...groups.values()].map((files) => {
    const main = files.find((f) => parseCoverName(f.file)?.kind === 'upload') ?? files[0]!
    const parsed = parseCoverName(main.file)
    const evidence: string[] = []
    const base = { cover_file: main.file, sha256: main.sha256 }
    if (files.length > 1) evidence.push(`${files.length} files have identical content (${files.map((f) => f.file.split(/[\\/]/).pop()).join(', ')}): one image, at most one book`)
    if (!parsed) return { ...base, book_id: null, method: null, confidence: 'unmatched' as Confidence, review_required: true, evidence: [...evidence, 'the file name does not follow the legacy cover naming, so it carries no timestamp'], competing_book_ids: [] as number[], strength: 0 }
    if (!parsed.consistent) evidence.push('the file name is NOT internally consistent: its date part disagrees with its timestamp, so the timestamp is not trusted')
    const visual = hashes?.covers?.[main.sha256]
    const visuallySame = visual && hashes?.pages ? Object.entries(hashes.pages).filter(([, h]) => hamming(visual, h) <= VISUAL_IDENTITY_BITS).map(([id]) => Number(id)) : []

    // 1. same request (documented): cover not later than the PDF, within 2 s
    const near = parsed.consistent ? stamped.filter((b) => b.epoch - parsed.epoch >= 0 && b.epoch - parsed.epoch <= SAME_REQUEST_SECONDS) : []
    const rivals = parsed.consistent ? covers.filter((c) => c.sha256 !== main.sha256).map((c) => ({ c, p: parseCoverName(c.file) })).filter(({ p }) => p?.consistent) : []
    if (near.length === 1) {
      const book = near[0]!
      // any OTHER cover inside the same window (nearer, further or in the same second) means the window is not ours alone: not verifiable
      const rival = rivals.some(({ p }) => p && book.epoch - p.epoch >= 0 && book.epoch - p.epoch <= SAME_REQUEST_SECONDS)
      if (!rival) {
        evidence.push(`cover stamp ${parsed.epoch} and PDF stamp ${book.epoch} are ${book.epoch - parsed.epoch} s apart: the contributor-approval path saves both in one request, an ordinary book needs a page navigation between them`)
        if (visuallySame.includes(book.id)) evidence.push('the cover is also visually the book\'s own first page')
        return { ...base, book_id: book.id, method: 'same_request_timestamp', confidence: 'verified' as Confidence, review_required: false, evidence, competing_book_ids: [] as number[], strength: 3 }
      }
    }
    if (near.length > 0) evidence.push(`${near.length} PDF(s) lie within ${SAME_REQUEST_SECONDS} s of this cover, or another cover is as close: not unique`)

    // 2. visual identity with exactly one book's own first page
    if (visuallySame.length === 1) {
      evidence.push(`the cover is visually identical (perceptual hash within ${VISUAL_IDENTITY_BITS} of 64 bits) to the first page of the book's own PDF`)
      return { ...base, book_id: visuallySame[0]!, method: 'visual_identity_with_own_pdf', confidence: 'candidate_strong' as Confidence, review_required: true, evidence, competing_book_ids: [] as number[], strength: 2 }
    }
    if (visuallySame.length > 1) evidence.push(`the cover looks like the first page of ${visuallySame.length} different PDFs: ambiguous`)

    // 3. ordinary flow: the unique, mutually nearest PDF added after this cover within 48 h
    if (parsed.consistent) {
      const after = stamped.filter((b) => b.epoch > parsed.epoch && b.epoch - parsed.epoch <= ORDINARY_WINDOW_SECONDS).sort((a, b) => a.epoch - b.epoch)
      const first = after[0]
      if (first) {
        const coversBeforeFirst = rivals.filter(({ p }) => p && p.epoch <= first.epoch && p.epoch > parsed.epoch)
        if (coversBeforeFirst.length === 0 && after.filter((b) => b.epoch === first.epoch).length === 1) {
          evidence.push(`the nearest PDF added after this cover is ${first.epoch - parsed.epoch} s later and no other cover lies between them: plausible create-then-add-contents order; a person must confirm`)
          return { ...base, book_id: first.id, method: 'adjacent_timestamp', confidence: 'candidate' as Confidence, review_required: true, evidence, competing_book_ids: after.slice(1, 4).map((b) => b.id), strength: 1 }
        }
        evidence.push('another cover or PDF sits between this cover and the nearest PDF: ambiguous')
      } else evidence.push('no PDF was added within 48 h after this cover')
    }
    return { ...base, book_id: null, method: null, confidence: 'unmatched' as Confidence, review_required: true, evidence, competing_book_ids: [] as number[], strength: 0 }
  })

  // one book gets at most one cover: when two covers claim a book, only the strongest evidence keeps it (ties lose both: unmatched, never a coin flip)
  const claims = new Map<number, typeof results>()
  for (const r of results) if (r.book_id != null) claims.set(r.book_id, [...(claims.get(r.book_id) ?? []), r])
  for (const r of results) {
    let { book_id, confidence, method, review_required } = r
    const evidence = [...r.evidence]
    if (book_id != null) {
      const rivals = claims.get(book_id)!.filter((x) => x !== r)
      const best = Math.max(r.strength, ...rivals.map((x) => x.strength))
      if (rivals.length && (r.strength < best || rivals.filter((x) => x.strength === best).length + (r.strength === best ? 1 : 0) > 1)) {
        evidence.push(`book ${book_id} is also claimed by ${rivals.length} other cover(s) with ${r.strength < best ? 'stronger' : 'equal'} evidence: no assignment`)
        book_id = null; confidence = 'unmatched'; method = null; review_required = true
      } else taken.set(book_id, r.sha256)
    }
    out.push({ cover_file: r.cover_file, sha256: r.sha256, book_id, method, confidence, review_required, evidence, competing_book_ids: r.competing_book_ids })
  }
  return out
}

/** What a recovered ORIGINAL cover may do to a book (the counterpart of decideGeneratedCover). It may replace a generated cover, never an original or a hand-uploaded one. */
export type OriginalAction = { action: 'skip'; reason: string } | { action: 'attach' | 'candidate' }
export function decideOriginalCover(book: { cover_path: string | null; recovery_evidence: { cover?: { current?: { provenance?: string; sha256?: string } | null; candidates?: Array<{ sha256?: string; provenance?: string }> } } | null }, match: Pick<Match, 'confidence' | 'sha256' | 'book_id'>): OriginalAction {
  if (match.book_id == null || match.confidence === 'unmatched') return { action: 'skip', reason: 'unmatched: no trustworthy relationship' }
  const cover = book.recovery_evidence?.cover
  const cur = cover?.current ?? null
  if (book.cover_path && cur?.provenance !== 'generated_from_pdf') return { action: 'skip', reason: 'the book already has an original or hand-uploaded cover (never overwritten)' }
  if (cur?.provenance === 'original_cover' && cur.sha256 === match.sha256) return { action: 'skip', reason: 'this original cover is already attached' }
  if ((cover?.candidates ?? []).some((c) => c.provenance === 'original_cover' && c.sha256 === match.sha256)) return { action: 'skip', reason: 'this original cover is already a candidate' }
  return { action: match.confidence === 'verified' ? 'attach' : 'candidate' }
}
