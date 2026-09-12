import { describe, expect, test } from 'bun:test'
import { isMaskedSecret } from './masked'

describe('isMaskedSecret', () => {
  test('recognises the mask the Servarr apps return for a secret', () => {
    expect(isMaskedSecret('********')).toBe(true)
  })

  test('recognises a mask of any length, since the apps do not agree on one', () => {
    expect(isMaskedSecret('****')).toBe(true)
    expect(isMaskedSecret('****************')).toBe(true)
  })

  test('an empty value is not a mask -- it is an unset field', () => {
    expect(isMaskedSecret('')).toBe(false)
  })

  test('a real value that merely contains asterisks is not a mask', () => {
    expect(isMaskedSecret('abc***')).toBe(false)
    expect(isMaskedSecret('***abc')).toBe(false)
  })

  test('a non-string is never a mask', () => {
    expect(isMaskedSecret(8080)).toBe(false)
    expect(isMaskedSecret(false)).toBe(false)
    expect(isMaskedSecret(null)).toBe(false)
    expect(isMaskedSecret(undefined)).toBe(false)
  })
})
