import { describe, expect, test } from 'bun:test'
import { hasServarrApi } from './deployment'

describe('hasServarrApi', () => {
  test('the Servarr applications have one', () => {
    for (const type of ['sonarr', 'radarr', 'lidarr', 'readarr', 'prowlarr']) {
      expect(hasServarrApi(type)).toBe(true)
    }
  })

  test('an unset type is treated as one, since it defaults to auto', () => {
    // Answering false here would skip the very checks a configuration with no
    // type stated is most likely to need.
    expect(hasServarrApi(undefined)).toBe(true)
  })

  test('the applications that are not Servarr do not', () => {
    // Answering true for one of these builds a ServarrManager pointed at an
    // endpoint that does not exist, and it waits for it to appear for ever.
    for (const type of ['qbittorrent', 'bazarr', 'sabnzbd', 'lazylibrarian']) {
      expect(hasServarrApi(type)).toBe(false)
    }
  })
})
