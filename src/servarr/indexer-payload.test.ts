import { describe, expect, test } from 'bun:test'
import { redactSecretFields, resolveIndexerRedirect } from './indexer-payload'

describe('resolveIndexerRedirect', () => {
  test('enables redirect for Newznab, which Prowlarr rejects without it', () => {
    expect(resolveIndexerRedirect({ implementation: 'Newznab' })).toBe(true)
  })

  test('matches the implementation regardless of case', () => {
    expect(resolveIndexerRedirect({ implementation: 'newznab' })).toBe(true)
  })

  test('leaves torrent indexers alone so Prowlarr applies its own default', () => {
    expect(resolveIndexerRedirect({ implementation: 'Cardigann' })).toBeUndefined()
    expect(resolveIndexerRedirect({ implementation: 'Torznab' })).toBeUndefined()
  })

  test('a configured value wins over the default in both directions', () => {
    expect(resolveIndexerRedirect({ implementation: 'Newznab', redirect: false })).toBe(false)
    expect(resolveIndexerRedirect({ implementation: 'Cardigann', redirect: true })).toBe(true)
  })
})

describe('redactSecretFields', () => {
  test('masks an indexer API key so it cannot reach the pod log', () => {
    const redacted = redactSecretFields([
      { name: 'baseUrl', value: 'https://api.example.com' },
      { name: 'apiKey', value: 'b056e2e01f94ea72c84f9c8c8774dc0d' },
    ])

    expect(redacted).toEqual([
      { name: 'baseUrl', value: 'https://api.example.com' },
      { name: 'apiKey', value: '***' },
    ])
  })

  test('masks the other credential-bearing fields Prowlarr uses', () => {
    const redacted = redactSecretFields([
      { name: 'passKey', value: 'secret' },
      { name: 'password', value: 'secret' },
      { name: 'cookie', value: 'secret' },
      { name: 'rssKey', value: 'secret' },
    ])

    expect(redacted.every((f) => f.value === '***')).toBe(true)
  })

  test('leaves an unnamed field alone rather than throwing on it', () => {
    const fields = [{ name: null, value: 'whatever' }]
    expect(redactSecretFields(fields)).toEqual(fields)
  })

  test('leaves a field list with no credentials untouched', () => {
    const fields = [{ name: 'definitionFile', value: 'nyaasi' }]
    expect(redactSecretFields(fields)).toEqual(fields)
  })

  test('tolerates an absent field list, which the generated type allows to be null', () => {
    expect(redactSecretFields(undefined)).toBeUndefined()
    expect(redactSecretFields(null)).toBeNull()
  })
})
