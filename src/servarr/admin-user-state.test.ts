import { describe, expect, test } from 'bun:test'
import { adminUserAction } from './admin-user-state'

const settled = { exists: true, passwordCurrent: true, duplicates: 0 }

describe('adminUserAction', () => {
  test('nothing to do once the user is present and correct', () => {
    // The whole point: this returned "create" on every reconcile, so the step
    // reported a change for ever and logged a creation that never happened.
    expect(adminUserAction(settled)).toBeNull()
  })

  test('creates the user when it is absent', () => {
    expect(adminUserAction({ ...settled, exists: false })).toBe('create')
  })

  test('updates when the stored password is not the configured one', () => {
    expect(adminUserAction({ ...settled, passwordCurrent: false })).toBe('update')
  })

  test('updates when other users are left to clear out', () => {
    // More than one user makes Prowlarr fail with "Sequence contains more
    // than one element", so leftovers are work even when the admin is fine.
    expect(adminUserAction({ ...settled, duplicates: 1 })).toBe('update')
  })

  test('creating takes precedence over tidying up', () => {
    expect(adminUserAction({ exists: false, passwordCurrent: false, duplicates: 2 })).toBe('create')
  })
})
