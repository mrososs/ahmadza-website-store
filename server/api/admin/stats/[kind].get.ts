import { adminReportQuerySchema } from '~~/shared/schemas/admin'
import { notFound } from '../../../utils/errors'

type Row = Record<string, string | number | null>
const csvCell = (v: unknown) => {
  let s = v === null || v === undefined ? '' : String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}` // neutralise spreadsheet formula injection
  return `"${s.replace(/"/g, '""')}"`
}
const toCsv = (rows: Row[]) => {
  if (!rows.length) return '﻿'
  const cols = Object.keys(rows[0]!)
  return '﻿' + [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\r\n')
}

// ADM-05..09: basic reports (users / books / orders / revenue) with date range, optional CSV export.
// Orders & revenue default to LIVE mode only so test-mode data never inflates reported money.
export default defineEventHandler(async (event) => {
  await adminRead(event)
  const kind = event.context.params?.kind
  const q = parseQuery(event, adminReportQuerySchema)
  const db = serviceClient(event)
  const from = q.from ? `${q.from}T00:00:00Z` : '1970-01-01T00:00:00Z'
  const to = q.to ? `${q.to}T23:59:59.999Z` : '2999-12-31T00:00:00Z'
  let rows: Row[] = []

  if (kind === 'users') {
    const { data, error } = await db.from('profiles').select('id,display_name,status,is_affiliate,created_at').is('deleted_at', null)
      .gte('created_at', from).lte('created_at', to).order('created_at', { ascending: false }).limit(5000)
    if (error) dbFail(error)
    rows = (data ?? []).map((u) => ({ id: u.id, name: u.display_name, status: u.status, affiliate: u.is_affiliate ? 'yes' : 'no', created_at: u.created_at }))
  } else if (kind === 'books') {
    const { data, error } = await db.from('books').select('id,title,kind,status,price_amount,price_currency,view_count,created_at').is('deleted_at', null)
      .gte('created_at', from).lte('created_at', to).order('view_count', { ascending: false }).limit(5000)
    if (error) dbFail(error)
    rows = (data ?? []).map((b) => ({ id: b.id, title: b.title, kind: b.kind, status: b.status, price: b.price_amount, currency: b.price_currency, views: b.view_count, created_at: b.created_at }))
  } else if (kind === 'orders' || kind === 'revenue') {
    let query = db.from('orders').select('id,order_no,status,mode,total_amount,currency,created_at,order_items(title_snapshot,unit_price)')
      .is('deleted_at', null).gte('created_at', from).lte('created_at', to)
    if (q.mode !== 'all') query = query.eq('mode', q.mode)
    if (kind === 'revenue') query = query.eq('status', 'paid')
    const { data, error } = await query.order('created_at', { ascending: false }).limit(5000)
    if (error) dbFail(error)
    if (kind === 'orders') {
      rows = (data ?? []).map((o) => ({ invoice: o.order_no, status: o.status, mode: o.mode, total: o.total_amount, currency: o.currency, created_at: o.created_at }))
    } else {
      // revenue per order line (legacy internal deductions are not recomputed here — they exist only on imported history)
      rows = (data ?? []).flatMap((o) => (o.order_items ?? []).map((i) => ({
        invoice: o.order_no, book: i.title_snapshot, unit_price: i.unit_price, currency: o.currency, mode: o.mode, created_at: o.created_at,
      })))
    }
  } else throw notFound('تقرير غير معروف')

  if (q.format === 'csv') {
    setHeader(event, 'content-type', 'text/csv; charset=utf-8')
    setHeader(event, 'content-disposition', `attachment; filename="report-${kind}.csv"`)
    return toCsv(rows)
  }
  const totals: Record<string, number> = {}
  if (kind === 'revenue') for (const r of rows) { const c = String(r.currency); totals[c] = Math.round(((totals[c] ?? 0) + Number(r.unit_price)) * 100) / 100 }
  if (kind === 'orders') for (const r of rows) if (r.status === 'paid') { const c = String(r.currency); totals[c] = Math.round(((totals[c] ?? 0) + Number(r.total)) * 100) / 100 }
  return { kind, count: rows.length, totals, rows }
})
