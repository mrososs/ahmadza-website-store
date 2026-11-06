// Arabic text normalisation for search. MUST stay equivalent to public.normalize_ar() in the database.
const DIACRITICS_AND_TATWEEL = /[ً-ٰٟـ]/g
const LETTER_MAP: Record<string, string> = { 'إ': 'ا', 'أ': 'ا', 'آ': 'ا', 'ى': 'ي', 'ة': 'ه' }

export function normalizeArabic(input: string | null | undefined): string {
  return (input ?? '')
    .replace(DIACRITICS_AND_TATWEEL, '')
    .replace(/[إأآىة]/g, (c) => LETTER_MAP[c] ?? c)
    .toLowerCase()
}

/** Escape a user term for use inside a PostgREST ilike pattern (% and _ are wildcards, `,()` split filters). */
export function ilikeTerm(input: string): string {
  return normalizeArabic(input).trim().replace(/[%_\\,()*]/g, ' ').replace(/\s+/g, ' ').trim()
}

export function slugify(title: string): string {
  return title.trim().toLowerCase().replace(/[^\w؀-ۿ]+/g, '-').replace(/^-+|-+$/g, '')
}
