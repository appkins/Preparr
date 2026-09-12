import { describe, expect, test } from 'bun:test'
import { scoreFor, toCustomFormat } from './convert'

const dtsHdMa = {
  trash_id: 'dcf3ec6938fa32445f590a4da84256cd',
  trash_scores: { default: 2500, 'sqp-1-1080p': -10000 },
  name: 'DTS-HD MA',
  includeCustomFormatWhenRenaming: false,
  specifications: [
    {
      name: 'DTS-HD MA',
      implementation: 'ReleaseTitleSpecification',
      negate: false,
      required: true,
      fields: { value: '\\bdts[-_. ]?(ma|hd)' },
    },
  ],
}

describe('toCustomFormat', () => {
  test('converts a guide definition into one the Servarr API accepts', () => {
    const cf = toCustomFormat(dtsHdMa)

    expect(cf.name).toBe('DTS-HD MA')
    expect(cf.includeCustomFormatWhenRenaming).toBe(false)
    expect(cf.specifications).toHaveLength(1)
    expect(cf.specifications[0]).toMatchObject({
      name: 'DTS-HD MA',
      implementation: 'ReleaseTitleSpecification',
      negate: false,
      required: true,
    })
  })

  test('turns the guide fields object into the array the API expects', () => {
    // The guide writes fields as {value: x}; Radarr and Sonarr take
    // [{name: 'value', value: x}] and reject the object form.
    expect(toCustomFormat(dtsHdMa).specifications[0]?.fields).toEqual([
      { name: 'value', value: '\\bdts[-_. ]?(ma|hd)' },
    ])
  })

  test('carries every field of a multi-field specification across', () => {
    const cf = toCustomFormat({
      ...dtsHdMa,
      specifications: [
        {
          name: 'Size',
          implementation: 'SizeSpecification',
          negate: false,
          required: true,
          fields: { min: 1, max: 5 },
        },
      ],
    })

    expect(cf.specifications[0]?.fields).toEqual([
      { name: 'min', value: 1 },
      { name: 'max', value: 5 },
    ])
  })

  test('accepts a definition that already uses the array form', () => {
    const cf = toCustomFormat({
      ...dtsHdMa,
      specifications: [
        {
          name: 'X',
          implementation: 'ReleaseTitleSpecification',
          negate: false,
          required: true,
          fields: [{ name: 'value', value: 'x' }],
        },
      ],
    })

    expect(cf.specifications[0]?.fields).toEqual([{ name: 'value', value: 'x' }])
  })

  test('tolerates a definition with no specifications', () => {
    const { specifications, ...withoutSpecs } = dtsHdMa
    expect(toCustomFormat(withoutSpecs).specifications).toEqual([])
  })
})

describe('scoreFor', () => {
  test('uses the guide default when no score set is named', () => {
    expect(scoreFor(dtsHdMa)).toBe(2500)
  })

  test('a named score set overrides the default', () => {
    // The whole point of a score set: sqp-1-1080p is the guide's own
    // small-file profile, where DTS-HD MA is rejected rather than preferred.
    expect(scoreFor(dtsHdMa, 'sqp-1-1080p')).toBe(-10000)
  })

  test('falls back to the default when the named set does not cover a format', () => {
    expect(scoreFor(dtsHdMa, 'no-such-set')).toBe(2500)
  })

  test('is undefined when the guide scores the format nowhere', () => {
    expect(scoreFor({ ...dtsHdMa, trash_scores: undefined })).toBeUndefined()
  })
})
