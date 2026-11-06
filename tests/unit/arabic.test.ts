import { describe, expect, it } from 'vitest'
import { ilikeTerm, normalizeArabic, slugify } from '~~/shared/utils/arabic'

describe('normalizeArabic', () => {
  it('removes diacritics and tatweel', () => {
    expect(normalizeArabic('كِتَـابٌ')).toBe('كتاب')
  })
  it('unifies alef / ya / ta-marbuta variants', () => {
    expect(normalizeArabic('أحمد إبراهيم آدم')).toBe('احمد ابراهيم ادم')
    expect(normalizeArabic('مكتبة')).toBe('مكتبه')
    expect(normalizeArabic('على')).toBe('علي')
  })
})

describe('ilikeTerm', () => {
  it('neutralises LIKE wildcards and PostgREST filter separators', () => {
    expect(ilikeTerm('100%_a,b(c)')).toBe('100 a b c')
  })
})

describe('slugify', () => {
  it('keeps Arabic letters and joins words', () => {
    expect(slugify('كتاب تجريبي رقم 1')).toBe('كتاب-تجريبي-رقم-1')
  })
})
