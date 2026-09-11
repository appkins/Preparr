import { describe, expect, test } from 'bun:test'
import {
  apiVersionFor,
  buildRootFolderBody,
  pickProfileId,
  requiresProfiles,
} from './root-folder-payload'

describe('requiresProfiles', () => {
  test('is true for the Lidarr-lineage apps', () => {
    expect(requiresProfiles('readarr')).toBe(true)
    expect(requiresProfiles('lidarr')).toBe(true)
  })

  test('is false for apps whose root folder is just a path', () => {
    expect(requiresProfiles('sonarr')).toBe(false)
    expect(requiresProfiles('radarr')).toBe(false)
  })
})

describe('apiVersionFor', () => {
  test('Readarr and Lidarr are still on v1', () => {
    expect(apiVersionFor('readarr')).toBe('v1')
    expect(apiVersionFor('lidarr')).toBe('v1')
  })

  test('Sonarr and Radarr are on v3', () => {
    expect(apiVersionFor('sonarr')).toBe('v3')
    expect(apiVersionFor('radarr')).toBe('v3')
  })
})

describe('buildRootFolderBody', () => {
  const defaults = { qualityProfileId: 1, metadataProfileId: 1 }

  test('supplies the three fields Readarr rejects the request without', () => {
    const body = buildRootFolderBody(
      { path: '/data/media/books', accessible: true, unmappedFolders: [] },
      defaults,
    )

    expect(body.name).toBe('books')
    expect(body.defaultQualityProfileId).toBe(1)
    expect(body.defaultMetadataProfileId).toBe(1)
    expect(body.path).toBe('/data/media/books')
  })

  test('a configured name and profile ids win over the instance defaults', () => {
    const body = buildRootFolderBody(
      {
        path: '/data/media/books',
        accessible: true,
        unmappedFolders: [],
        name: 'Books',
        defaultQualityProfileId: 2,
        defaultMetadataProfileId: 2,
      },
      defaults,
    )

    expect(body.name).toBe('Books')
    expect(body.defaultQualityProfileId).toBe(2)
    expect(body.defaultMetadataProfileId).toBe(2)
  })

  test('a trailing slash still yields a name, since an empty one is rejected', () => {
    const body = buildRootFolderBody(
      { path: '/data/media/books/', accessible: true, unmappedFolders: [] },
      defaults,
    )

    expect(body.name).toBe('books')
  })
})

describe('pickProfileId', () => {
  test('skips Readarr\'s "None" metadata profile, which stores no metadata at all', () => {
    expect(
      pickProfileId([
        { id: 2, name: 'None' },
        { id: 1, name: 'Standard' },
      ]),
    ).toBe(1)
  })

  test('falls back to the lowest id when every profile is usable', () => {
    expect(
      pickProfileId([
        { id: 3, name: 'Spoken' },
        { id: 1, name: 'eBook' },
      ]),
    ).toBe(1)
  })

  test('uses "None" rather than nothing when it is the only profile', () => {
    expect(pickProfileId([{ id: 2, name: 'None' }])).toBe(2)
  })

  test('throws when the instance has no profiles, rather than sending id 0', () => {
    expect(() => pickProfileId([])).toThrow()
  })
})
