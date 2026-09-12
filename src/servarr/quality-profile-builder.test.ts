import { describe, expect, test } from 'bun:test'
import { buildQualityProfile, type ProfileSchema } from './quality-profile-builder'

const schema: ProfileSchema = {
  name: '',
  upgradeAllowed: false,
  cutoff: 0,
  minFormatScore: 0,
  cutoffFormatScore: 0,
  items: [
    { quality: { id: 1, name: 'SDTV' }, allowed: false },
    { quality: { id: 6, name: 'Bluray-720p' }, allowed: false },
    {
      id: 1002,
      name: 'WEB 1080p',
      allowed: false,
      items: [
        { quality: { id: 3, name: 'WEBDL-1080p' }, allowed: false },
        { quality: { id: 15, name: 'WEBRip-1080p' }, allowed: false },
      ],
    },
    { quality: { id: 7, name: 'Bluray-1080p' }, allowed: false },
    { quality: { id: 30, name: 'Remux-1080p' }, allowed: false },
  ],
  formatItems: [
    { format: 1, name: 'DD+', score: 0 },
    { format: 2, name: 'DTS-HD MA', score: 0 },
    { format: 3, name: 'AAC', score: 0 },
  ],
}

const desired = {
  name: 'HD WEB',
  qualities: ['Bluray-1080p', 'WEB 1080p', 'Bluray-720p'],
}

describe('buildQualityProfile', () => {
  test('allows exactly the named qualities and nothing else', () => {
    const profile = buildQualityProfile(schema, desired)

    const allowed = profile.items.filter((i) => i.allowed).map((i) => i.name ?? i.quality?.name)
    expect(allowed.sort()).toEqual(['Bluray-1080p', 'Bluray-720p', 'WEB 1080p'])

    const denied = profile.items.filter((i) => !i.allowed).map((i) => i.name ?? i.quality?.name)
    expect(denied.sort()).toEqual(['Remux-1080p', 'SDTV'])
  })

  test('ranks the most preferred quality last, which is how the API orders them', () => {
    const profile = buildQualityProfile(schema, desired)
    const names = profile.items.map((i) => i.name ?? i.quality?.name)

    // Config lists most-preferred first; the array runs worst to best.
    expect(names.slice(-3)).toEqual(['Bluray-720p', 'WEB 1080p', 'Bluray-1080p'])
  })

  test('keeps the qualities it disabled, so the profile stays complete', () => {
    expect(buildQualityProfile(schema, desired).items).toHaveLength(schema.items.length)
  })

  test('resolves the cutoff to the id of the named quality', () => {
    expect(buildQualityProfile(schema, { ...desired, cutoffQuality: 'Bluray-720p' }).cutoff).toBe(6)
  })

  test('resolves a cutoff naming a group to the group id', () => {
    expect(buildQualityProfile(schema, { ...desired, cutoffQuality: 'WEB 1080p' }).cutoff).toBe(
      1002,
    )
  })

  test('defaults the cutoff to the most preferred quality', () => {
    expect(buildQualityProfile(schema, desired).cutoff).toBe(7)
  })

  test('applies custom format scores by name and leaves the rest at zero', () => {
    const profile = buildQualityProfile(schema, {
      ...desired,
      scores: { 'DD+': 400, 'DTS-HD MA': -10000 },
    })

    expect(profile.formatItems).toEqual([
      { format: 1, name: 'DD+', score: 400 },
      { format: 2, name: 'DTS-HD MA', score: -10000 },
      { format: 3, name: 'AAC', score: 0 },
    ])
  })

  test('names the quality it could not find rather than silently dropping it', () => {
    expect(() => buildQualityProfile(schema, { ...desired, qualities: ['Bluray-4320p'] })).toThrow(
      /Bluray-4320p/,
    )
  })

  test('names a scored format the instance does not have', () => {
    // A typo here would otherwise score nothing at all and look like it worked.
    expect(() => buildQualityProfile(schema, { ...desired, scores: { 'DD Plus': 400 } })).toThrow(
      /DD Plus/,
    )
  })

  test('carries the profile name and upgrade settings through', () => {
    const profile = buildQualityProfile(schema, {
      ...desired,
      upgradeAllowed: true,
      minFormatScore: 100,
      cutoffFormatScore: 10000,
    })

    expect(profile).toMatchObject({
      name: 'HD WEB',
      upgradeAllowed: true,
      minFormatScore: 100,
      cutoffFormatScore: 10000,
    })
  })
})
