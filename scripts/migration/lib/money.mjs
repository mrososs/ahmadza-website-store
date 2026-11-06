// Parsing of the legacy `varchar` money columns (docs/legacy-audit/08, 14 §6). Exact decimal strings only:
// no floating point is used to read, compare or store a historical amount. The raw string always travels with the value.

const ARABIC_INDIC = { '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9' }
const PERSIAN = { '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9' }

/** Normalise digits / separators / whitespace of a money string. Pure. */
export function normalizeMoneyString(raw) {
  return String(raw)
    .replace(/[٠-٩]/g, (c) => ARABIC_INDIC[c])
    .replace(/[۰-۹]/g, (c) => PERSIAN[c])
    .replace(/[٫]/g, '.') // Arabic decimal separator
    // eslint-disable-next-line no-irregular-whitespace -- the class intentionally contains nbsp / Arabic separators
    .replace(/[٬ ‎‏\s]/g, '') // Arabic thousands separator, nbsp, bidi marks, spaces
}

/** Round a plain decimal string half-up to `dp` places using integer string math. */
export function roundDecimal(s, dp = 2) {
  const neg = s.startsWith('-')
  const [intPart, frac = ''] = (neg ? s.slice(1) : s).split('.')
  if (frac.length <= dp) return `${neg ? '-' : ''}${intPart}.${frac.padEnd(dp, '0')}`
  const keep = frac.slice(0, dp)
  const next = frac.charCodeAt(dp) - 48
  let n = BigInt(intPart + keep) + (next >= 5 ? 1n : 0n)
  let str = n.toString().padStart(dp + 1, '0')
  str = `${str.slice(0, -dp)}.${str.slice(-dp)}`
  return `${neg && n !== 0n ? '-' : ''}${str}`
}

/**
 * @param {unknown} raw legacy value (string | number | null)
 * @returns {{ ok: true, value: string, raw: string, rounded: boolean } | { ok: false, raw: string|null, reason: string }}
 */
export function parseMoney(raw, { dp = 2, allowNegative = false } = {}) {
  if (raw === null || raw === undefined) return { ok: false, raw: null, reason: 'null' }
  const rawStr = String(raw)
  let s = normalizeMoneyString(rawStr)
  if (s === '') return { ok: false, raw: rawStr, reason: 'empty' }
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replaceAll(',', '') // 1,234.50
  if (!/^-?\d+(\.\d+)?$/.test(s)) return { ok: false, raw: rawStr, reason: 'not a plain decimal number (ambiguous separators or text)' }
  if (s.startsWith('-') && !allowNegative) return { ok: false, raw: rawStr, reason: 'negative amount' }
  if (s.replace('-', '').split('.')[0].length > 10) return { ok: false, raw: rawStr, reason: 'exceeds numeric(12,2)' }
  const frac = s.split('.')[1] ?? ''
  const significantExtra = frac.length > dp && /[1-9]/.test(frac.slice(dp))
  return { ok: true, value: roundDecimal(s, dp), raw: rawStr, rounded: significantExtra }
}

/** |a-b| > 0.005 on exact decimal strings (used to flag float residue in legacy balances). */
export function differsMoreThanHalfCent(a, b) {
  const scale = (s) => { const [i, f = ''] = roundDecimal(s, 4).split('.'); return BigInt(i + f) }
  const d = scale(a) - scale(b)
  return (d < 0n ? -d : d) > 50n
}

/** Exact decimal sum of already-parsed values (strings with 2 dp). */
export function sumDecimals(values, dp = 2) {
  const total = values.reduce((acc, v) => acc + BigInt(roundDecimal(v, dp).replace('.', '')), 0n)
  const s = total.toString().padStart(dp + 1, '0')
  return `${s.slice(0, -dp)}.${s.slice(-dp)}`
}
