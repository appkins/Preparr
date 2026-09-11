import { describe, expect, test } from 'bun:test'
import { AppConfigSchema, ServarrConfigSchema, ServiceIntegrationSchema } from './schema'

describe('services.sabnzbd', () => {
  test('accepts a url and api key', () => {
    const parsed = ServiceIntegrationSchema.parse({
      sabnzbd: { url: 'http://sabnzbd:8080', apiKey: 'a'.repeat(32) },
    })

    expect(parsed.sabnzbd?.url).toBe('http://sabnzbd:8080')
    expect(parsed.sabnzbd?.apiKey).toBe('a'.repeat(32))
  })

  test('rejects a value that is not a url', () => {
    // Note "sabnzbd:8080" is deliberately not the example here -- that parses
    // as a URI with scheme "sabnzbd:", and the sibling qbittorrent.url accepts
    // it too. Only something with no scheme at all is rejected.
    expect(() => ServiceIntegrationSchema.parse({ sabnzbd: { url: 'not a url' } })).toThrow()
  })
})

describe('app.sabnzbd', () => {
  test('defaults to no categories and no servers', () => {
    const parsed = AppConfigSchema.parse({ sabnzbd: {} })

    expect(parsed.sabnzbd?.categories).toEqual([])
    expect(parsed.sabnzbd?.servers).toEqual([])
  })

  test('carries complete and incomplete download paths', () => {
    const parsed = AppConfigSchema.parse({
      sabnzbd: {
        downloads: { completePath: '/data/usenet/complete', incompletePath: '/data/usenet/in' },
      },
    })

    expect(parsed.sabnzbd?.downloads?.completePath).toBe('/data/usenet/complete')
    expect(parsed.sabnzbd?.downloads?.incompletePath).toBe('/data/usenet/in')
  })

  test('keeps a category directory relative to the complete path', () => {
    const parsed = AppConfigSchema.parse({
      sabnzbd: { categories: [{ name: 'tv', dir: 'tv' }] },
    })

    expect(parsed.sabnzbd?.categories[0]).toMatchObject({ name: 'tv', dir: 'tv', priority: -100 })
  })

  test('defaults a server to the standard ssl news port', () => {
    const parsed = AppConfigSchema.parse({
      sabnzbd: {
        servers: [{ name: 'news', host: 'news.example.com', username: 'u', password: 'p' }],
      },
    })

    expect(parsed.sabnzbd?.servers[0]).toMatchObject({
      host: 'news.example.com',
      port: 563,
      ssl: true,
      connections: 8,
      enable: true,
    })
  })

  test('requires a host on a server', () => {
    expect(() => AppConfigSchema.parse({ sabnzbd: { servers: [{ name: 'news' }] } })).toThrow()
  })
})

describe('servarr.type sabnzbd', () => {
  test('is a deployable type so SABnzbd can run its own sidecar', () => {
    const parsed = ServarrConfigSchema.parse({ type: 'sabnzbd', adminUser: 'admin' })

    expect(parsed.type).toBe('sabnzbd')
  })

  test('needs no servarr url, like qbittorrent and bazarr', () => {
    // SABnzbd is reached through services.sabnzbd; servarr.url addresses a
    // Servarr API this deployment does not have.
    expect(() => ServarrConfigSchema.parse({ type: 'sabnzbd' })).not.toThrow()
  })
})
