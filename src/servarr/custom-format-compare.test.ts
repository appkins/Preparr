import { describe, expect, test } from 'bun:test'
import { customFormatMatches } from './custom-format-compare'

// What a deployment declares.
const desired = {
  name: 'Repack2',
  includeCustomFormatWhenRenaming: false,
  specifications: [
    {
      name: 'Repack/Proper 2',
      implementation: 'ReleaseTitleSpecification',
      negate: false,
      required: true,
      fields: [{ name: 'value', value: '\\b((repack|proper)2)\\b' }],
    },
  ],
}

// The same format read back, as the app returns it.
const current = {
  id: 8,
  name: 'Repack2',
  includeCustomFormatWhenRenaming: false,
  specifications: [
    {
      name: 'Repack/Proper 2',
      implementation: 'ReleaseTitleSpecification',
      implementationName: 'Release Title',
      infoLink: 'https://wiki.servarr.com/radarr/settings#custom-formats-2',
      negate: false,
      required: true,
      fields: [
        {
          order: 0,
          name: 'value',
          label: 'Regular Expression',
          helpText: 'Custom Format RegEx is Case Insensitive',
          value: '\\b((repack|proper)2)\\b',
          type: 'textbox',
          advanced: false,
          privacy: 'normal',
          isFloat: false,
        },
      ],
    },
  ],
}

describe('customFormatMatches', () => {
  test('the app adding its own metadata is not a difference', () => {
    // This is the whole bug: the app returns implementationName, infoLink and
    // eight field attributes it invented, none of which were ever sent. A
    // literal comparison can never match, so every format was rewritten on
    // every reconcile, for ever.
    expect(customFormatMatches(current, desired)).toBe(true)
  })

  test('a changed regex is a difference', () => {
    const changed = structuredClone(desired)
    changed.specifications[0].fields[0].value = '\\bdifferent\\b'

    expect(customFormatMatches(current, changed)).toBe(false)
  })

  test('a negated specification is a difference', () => {
    const changed = structuredClone(desired)
    changed.specifications[0].negate = true

    expect(customFormatMatches(current, changed)).toBe(false)
  })

  test('a renamed specification is a difference', () => {
    const changed = structuredClone(desired)
    changed.specifications[0].name = 'Something else'

    expect(customFormatMatches(current, changed)).toBe(false)
  })

  test('a different implementation is a difference', () => {
    const changed = structuredClone(desired)
    changed.specifications[0].implementation = 'SizeSpecification'

    expect(customFormatMatches(current, changed)).toBe(false)
  })

  test('an added specification is a difference', () => {
    const changed = structuredClone(desired)
    changed.specifications.push({ ...desired.specifications[0], name: 'Second' })

    expect(customFormatMatches(current, changed)).toBe(false)
  })

  test('the renaming flag is compared', () => {
    expect(
      customFormatMatches(current, { ...desired, includeCustomFormatWhenRenaming: true }),
    ).toBe(false)
  })

  test('specification order is not a difference', () => {
    const twoSpecs = {
      ...current,
      specifications: [
        { ...current.specifications[0], name: 'A' },
        { ...current.specifications[0], name: 'B' },
      ],
    }
    const reversed = {
      ...desired,
      specifications: [
        { ...desired.specifications[0], name: 'B' },
        { ...desired.specifications[0], name: 'A' },
      ],
    }

    expect(customFormatMatches(twoSpecs, reversed)).toBe(true)
  })

  test('a number read back as a number matches the number sent', () => {
    // Size specifications carry numbers, and the guide writes them unquoted.
    const sized = {
      ...current,
      specifications: [
        { ...current.specifications[0], fields: [{ name: 'min', value: 5, order: 0 }] },
      ],
    }
    const sizedDesired = {
      ...desired,
      specifications: [{ ...desired.specifications[0], fields: [{ name: 'min', value: 5 }] }],
    }

    expect(customFormatMatches(sized, sizedDesired)).toBe(true)
  })

  test('a field the app reports but the format does not declare is ignored', () => {
    const extra = {
      ...current,
      specifications: [
        {
          ...current.specifications[0],
          fields: [...current.specifications[0].fields, { name: 'exceptLanguage', value: false }],
        },
      ],
    }

    expect(customFormatMatches(extra, desired)).toBe(true)
  })
})
