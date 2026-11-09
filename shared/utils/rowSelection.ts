// Row selection that survives pagination, search and filter changes: it is keyed by id, never by the visible page.
// Nothing here selects rows the administrator has not ticked (there is deliberately no "select all filtered results").
import { computed, ref } from 'vue'

export type PageState = 'none' | 'some' | 'all'

export function useRowSelection<T extends { id: number }>(label: (row: T) => string) {
  const selected = ref(new Map<number, string>())
  const ids = computed(() => [...selected.value.keys()])
  const count = computed(() => selected.value.size)
  const has = (id: number) => selected.value.has(id)
  const commit = (m: Map<number, string>) => { selected.value = m } // a new Map each time: cheap and keeps reactivity trivial

  function set(row: T, on: boolean) {
    const m = new Map(selected.value)
    if (on) m.set(row.id, label(row)); else m.delete(row.id)
    commit(m)
  }
  function toggle(row: T) { set(row, !has(row.id)) }
  /** Tick / untick exactly the rows of the current page; selections made on other pages are left alone. */
  function setPage(rows: readonly T[], on: boolean) {
    const m = new Map(selected.value)
    for (const r of rows) { if (on) m.set(r.id, label(r)); else m.delete(r.id) }
    commit(m)
  }
  function pageState(rows: readonly T[] | undefined): PageState {
    if (!rows?.length) return 'none'
    const n = rows.filter((r) => has(r.id)).length
    return n === 0 ? 'none' : n === rows.length ? 'all' : 'some'
  }
  function remove(removeIds: readonly number[]) {
    const m = new Map(selected.value)
    for (const id of removeIds) m.delete(id)
    commit(m)
  }
  function clear() { commit(new Map()) }
  return { selected, ids, count, has, set, toggle, setPage, pageState, remove, clear }
}
