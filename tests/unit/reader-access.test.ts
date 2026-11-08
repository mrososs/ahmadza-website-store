import { describe, expect, it } from 'vitest'
import { decideReaderAccess, type ReaderFacts } from '../../shared/utils/readerAccess'

const base: ReaderFacts = { status: 'published', kind: 'paid', isAdmin: false, signedIn: false, hasEntitlement: false, fileAvailable: true }
const d = (o: Partial<ReaderFacts>) => decideReaderAccess({ ...base, ...o })

describe('reader access decision', () => {
  it('a published free book opens for a guest', () => expect(d({ kind: 'free' })).toEqual({ state: 'granted', via: 'free' }))
  it('a paid book needs an entitlement; guests and signed-in non-owners are refused', () => {
    expect(d({}).state).toBe('login_required')
    expect(d({ signedIn: true }).state).toBe('purchase_required')
    expect(d({ signedIn: true, hasEntitlement: true })).toEqual({ state: 'granted', via: 'owner' })
  })
  it('an unpublished free book is not free: it does not exist for the public', () => {
    expect(d({ kind: 'free', status: 'draft' }).state).toBe('not_found')
    expect(d({ kind: 'free', status: 'coming_soon' }).state).toBe('login_required')
  })
  it('an entitlement does not open a draft for a non-admin, admins may review it', () => {
    expect(d({ status: 'draft', signedIn: true, hasEntitlement: true }).state).toBe('not_found')
    expect(d({ status: 'draft', isAdmin: true, signedIn: true })).toEqual({ state: 'granted', via: 'admin' })
  })
  it('an outsider is never told whether the file exists; an allowed reader gets the honest pending state', () => {
    expect(d({ fileAvailable: false }).state).toBe('login_required')
    expect(d({ fileAvailable: false, signedIn: true }).state).toBe('purchase_required')
    expect(d({ fileAvailable: false, kind: 'free' })).toEqual({ state: 'unavailable', via: 'free' })
  })
})
