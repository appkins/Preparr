import { describe, expect, test } from 'bun:test'
import { hasServarrApi } from './deployment'

describe('hasServarrApi', () => {
  test('is true for the Servarr apps', () => {
    for (const type of ['sonarr', 'radarr', 'lidarr', 'readarr', 'prowlarr'] as const) {
      expect(hasServarrApi(type)).toBe(true)
    }
  })

  test('is false for the download clients and bazarr', () => {
    // These are reached through their own services.* entry and have no
    // Servarr API, so constructing a ServarrManager for them would point at
    // an endpoint that does not exist.
    for (const type of ['qbittorrent', 'bazarr', 'sabnzbd'] as const) {
      expect(hasServarrApi(type)).toBe(false)
    }
  })

  test('is true for auto, which resolves to a Servarr app at runtime', () => {
    expect(hasServarrApi('auto')).toBe(true)
  })
})
