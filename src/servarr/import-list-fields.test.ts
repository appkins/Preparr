import { describe, expect, test } from 'bun:test'
import { importListMatches, withInstanceOwnedFields } from './import-list-fields'

const desired = [
  { name: 'username', value: 'appkins' },
  { name: 'traktListType', value: 0 },
  { name: 'limit', value: 100 },
]

const current = [
  { name: 'accessToken', value: 'real-access-token' },
  { name: 'refreshToken', value: 'real-refresh-token' },
  { name: 'expires', value: '2027-01-01T00:00:00Z' },
  { name: 'authUser', value: 'appkins' },
  { name: 'username', value: 'appkins' },
  { name: 'traktListType', value: 0 },
  { name: 'limit', value: 100 },
]

describe('withInstanceOwnedFields', () => {
  test('carries the OAuth tokens over from the instance', () => {
    // These only exist because someone completed a browser sign-in. Sending
    // the config's empty values instead would sign the instance out on the
    // next reconcile, and the list would silently stop importing.
    const merged = withInstanceOwnedFields(current, desired)
    const byName = Object.fromEntries(merged.map((f) => [f.name, f.value]))

    expect(byName.accessToken).toBe('real-access-token')
    expect(byName.refreshToken).toBe('real-refresh-token')
    expect(byName.expires).toBe('2027-01-01T00:00:00Z')
    expect(byName.authUser).toBe('appkins')
  })

  test('keeps the configured values for everything else', () => {
    const merged = withInstanceOwnedFields(current, [{ name: 'username', value: 'someone-else' }])

    expect(merged.find((f) => f.name === 'username')?.value).toBe('someone-else')
  })

  test('adds nothing when the instance has no tokens yet', () => {
    const merged = withInstanceOwnedFields([], desired)

    expect(merged.map((f) => f.name).sort()).toEqual(['limit', 'traktListType', 'username'])
  })

  test("a token the configuration does set is still the configuration's", () => {
    // Supplying tokens outright is legitimate -- they can be lifted from
    // another instance -- and an explicit value should win.
    const merged = withInstanceOwnedFields(current, [
      ...desired,
      { name: 'accessToken', value: 'from-config' },
    ])

    expect(merged.find((f) => f.name === 'accessToken')?.value).toBe('from-config')
  })
})

describe('importListMatches', () => {
  const list = { name: 'Trakt', implementation: 'TraktUserImport', fields: desired }

  test('an instance holding tokens still matches a config without them', () => {
    // Otherwise every reconcile would see a difference that can never be
    // resolved, and rewrite the list for ever.
    expect(importListMatches({ ...list, fields: current }, list)).toBe(true)
  })

  test('a changed setting is a difference', () => {
    const changed = { ...list, fields: [{ name: 'username', value: 'someone-else' }] }

    expect(importListMatches({ ...list, fields: current }, changed)).toBe(false)
  })

  test('a value the app returns as a string matches the number configured', () => {
    const asStrings = [{ name: 'limit', value: '100' }]

    expect(
      importListMatches(
        { ...list, fields: asStrings },
        { ...list, fields: [{ name: 'limit', value: 100 }] },
      ),
    ).toBe(true)
  })

  test('a changed implementation is a difference', () => {
    expect(
      importListMatches(
        { ...list, fields: current },
        { ...list, implementation: 'TraktListImport' },
      ),
    ).toBe(false)
  })
})
