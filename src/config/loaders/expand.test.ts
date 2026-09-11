// biome-ignore-all lint/suspicious/noTemplateCurlyInString: these are the literal ${VAR} placeholders under test, not template literals
import { describe, expect, test } from 'bun:test'
import { expandEnvReferences } from './expand'

describe('expandEnvReferences', () => {
  test('substitutes a reference in a string value', () => {
    const out = expandEnvReferences({ password: '${NEWS_PASSWORD}' }, { NEWS_PASSWORD: 's3cret' })

    expect(out).toEqual({ password: 's3cret' })
  })

  test('substitutes inside a larger string', () => {
    const out = expandEnvReferences({ url: 'http://${HOST}:8080' }, { HOST: 'sabnzbd' })

    expect(out).toEqual({ url: 'http://sabnzbd:8080' })
  })

  test('walks nested objects and arrays', () => {
    const out = expandEnvReferences({ servers: [{ auth: { password: '${P}' } }] }, { P: 'hunter2' })

    expect(out).toEqual({ servers: [{ auth: { password: 'hunter2' } }] })
  })

  test('leaves non-strings untouched', () => {
    const out = expandEnvReferences({ port: 563, ssl: true, retention: null }, {})

    expect(out).toEqual({ port: 563, ssl: true, retention: null })
  })

  test('leaves a string with no reference untouched', () => {
    const out = expandEnvReferences({ host: 'news.example.com' }, {})

    expect(out).toEqual({ host: 'news.example.com' })
  })

  test('throws on an unset reference rather than writing the literal text', () => {
    // Writing "${NEWS_PASSWORD}" through as a password is silently wrong and
    // would be stored as the credential; failing loudly is the only safe
    // reading of a missing secret.
    expect(() => expandEnvReferences({ password: '${MISSING}' }, {})).toThrow(/MISSING/)
  })

  test('names the offending path in the error', () => {
    expect(() => expandEnvReferences({ servers: [{ password: '${MISSING}' }] }, {})).toThrow(
      /servers\.0\.password/,
    )
  })

  test('does not expand an escaped reference', () => {
    const out = expandEnvReferences({ literal: '$${NOT_A_VAR}' }, {})

    expect(out).toEqual({ literal: '${NOT_A_VAR}' })
  })
})
