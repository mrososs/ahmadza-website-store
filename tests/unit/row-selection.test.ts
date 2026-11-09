import { describe, expect, it } from 'vitest'
import { useRowSelection } from '../../shared/utils/rowSelection'

const rows = (from: number, n: number) => Array.from({ length: n }, (_, i) => ({ id: from + i, title: `كتاب ${from + i}` }))
const mk = () => useRowSelection<{ id: number; title: string }>((r) => r.title)

describe('row selection', () => {
  it('selects and deselects single rows, and counts exactly', () => {
    const s = mk(); const [a, b] = rows(1, 2) as [{ id: number; title: string }, { id: number; title: string }]
    s.toggle(a); s.toggle(b)
    expect(s.count.value).toBe(2); expect(s.has(1)).toBe(true)
    s.toggle(a)
    expect(s.ids.value).toEqual([2])
  })
  it('header state is none / some / all for the current page', () => {
    const s = mk(); const page = rows(1, 3)
    expect(s.pageState(page)).toBe('none')
    s.set(page[0]!, true); expect(s.pageState(page)).toBe('some')
    s.setPage(page, true); expect(s.pageState(page)).toBe('all')
    s.setPage(page, false); expect(s.pageState(page)).toBe('none')
    expect(s.pageState(undefined)).toBe('none'); expect(s.pageState([])).toBe('none')
  })
  it('select-all-on-page touches only that page and keeps selections from other pages', () => {
    const s = mk(); const p1 = rows(1, 3), p2 = rows(10, 3)
    s.setPage(p1, true); s.setPage(p2, true)
    expect(s.count.value).toBe(6)
    s.setPage(p2, false)
    expect(s.ids.value).toEqual([1, 2, 3]) // page 1 untouched
  })
  it('selection is by id: it survives a filter change / refresh that shows other rows', () => {
    const s = mk(); s.setPage(rows(1, 2), true)
    const filtered = rows(50, 2) // a different result set
    expect(s.pageState(filtered)).toBe('none'); expect(s.count.value).toBe(2)
    expect(s.pageState(rows(1, 2))).toBe('all') // and it is back when those rows return
  })
  it('never selects rows that were not ticked (no implicit select-all-filtered)', () => {
    const s = mk(); s.set(rows(1, 1)[0]!, true)
    expect(s.count.value).toBe(1)
  })
  it('remove drops only the given ids; clear empties', () => {
    const s = mk(); s.setPage(rows(1, 4), true)
    s.remove([2, 3, 99]); expect(s.ids.value).toEqual([1, 4])
    s.clear(); expect(s.count.value).toBe(0)
  })
})
