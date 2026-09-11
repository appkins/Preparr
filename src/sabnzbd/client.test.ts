import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { SabnzbdConfig } from '@/config/schema'
import { SabnzbdManager } from './client'

type Call = { url: string; params: URLSearchParams }

const realFetch = globalThis.fetch
let calls: Call[]

/** Records every request and replays a canned SABnzbd JSON response. */
function stubFetch(response: unknown = { status: true }, ok = true) {
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const body = typeof init?.body === 'string' ? init.body : ''
    calls.push({ url: String(input), params: new URLSearchParams(body) })
    return Promise.resolve(
      new Response(JSON.stringify(response), {
        status: ok ? 200 : 500,
        headers: { 'content-type': 'application/json' },
      }),
    )
  }) as typeof fetch
}

function manager() {
  return new SabnzbdManager({ url: 'http://sabnzbd:8080', apiKey: 'k'.repeat(32) })
}

/** Params of the call that set `keyword` in `section`. */
function callFor(section: string, keyword: string) {
  return calls.find(
    (c) => c.params.get('section') === section && c.params.get('keyword') === keyword,
  )?.params
}

beforeEach(() => {
  calls = []
})

afterEach(() => {
  globalThis.fetch = realFetch
})

describe('SabnzbdManager.testConnection', () => {
  test('reports success when the version endpoint answers', async () => {
    stubFetch({ version: '4.3.1' })

    expect(await manager().testConnection()).toBe(true)
    expect(calls[0]?.params.get('mode')).toBe('version')
  })

  test('authenticates every request with the api key', async () => {
    stubFetch({ version: '4.3.1' })

    await manager().testConnection()

    expect(calls[0]?.params.get('apikey')).toBe('k'.repeat(32))
  })

  test('reports failure when the host is unreachable', async () => {
    globalThis.fetch = (() => Promise.reject(new Error('ECONNREFUSED'))) as typeof fetch

    expect(await manager().testConnection()).toBe(false)
  })

  test('reports failure when the api key is rejected', async () => {
    // SABnzbd answers 200 with {status: false} rather than an HTTP error.
    stubFetch({ status: false, error: 'API Key Incorrect' })

    expect(await manager().testConnection()).toBe(false)
  })
})

describe('SabnzbdManager.isReady', () => {
  test('is not ready until initialized', async () => {
    stubFetch({ version: '4.3.1' })
    const client = manager()

    expect(client.isReady()).toBe(false)
    await client.initialize()
    expect(client.isReady()).toBe(true)
  })
})

describe('SabnzbdManager.applyConfiguration', () => {
  test('does nothing without configuration', async () => {
    stubFetch()

    await manager().applyConfiguration(undefined)

    expect(calls).toHaveLength(0)
  })

  test('sets the completed and incomplete directories', async () => {
    stubFetch()
    const config = {
      downloads: {
        completePath: '/data/usenet/complete',
        incompletePath: '/data/usenet/incomplete',
      },
      categories: [],
      servers: [],
    } as SabnzbdConfig

    await manager().applyConfiguration(config)

    expect(callFor('misc', 'complete_dir')?.get('value')).toBe('/data/usenet/complete')
    expect(callFor('misc', 'download_dir')?.get('value')).toBe('/data/usenet/incomplete')
  })

  test('adds each category with its directory', async () => {
    stubFetch()
    const config = {
      categories: [
        { name: 'tv', dir: 'tv', priority: -100, script: 'Default' },
        { name: 'movies', dir: 'movies', priority: -100, script: 'Default' },
      ],
      servers: [],
    } as SabnzbdConfig

    await manager().applyConfiguration(config)

    expect(callFor('categories', 'tv')?.get('dir')).toBe('tv')
    expect(callFor('categories', 'movies')?.get('dir')).toBe('movies')
    expect(callFor('categories', 'tv')?.get('priority')).toBe('-100')
  })

  test('adds a server keyed by name', async () => {
    stubFetch()
    const config = {
      categories: [],
      servers: [
        {
          name: 'frugal',
          host: 'news.example.com',
          port: 563,
          username: 'u',
          password: 'p',
          connections: 20,
          ssl: true,
          enable: true,
          priority: 0,
        },
      ],
    } as SabnzbdConfig

    await manager().applyConfiguration(config)

    const server = callFor('servers', 'frugal')
    expect(server?.get('host')).toBe('news.example.com')
    expect(server?.get('port')).toBe('563')
    expect(server?.get('connections')).toBe('20')
    expect(server?.get('ssl')).toBe('1')
  })

  test('falls back to the host as the server name', async () => {
    stubFetch()
    const config = {
      categories: [],
      servers: [
        {
          host: 'news.example.com',
          port: 563,
          connections: 8,
          ssl: true,
          enable: true,
          priority: 0,
        },
      ],
    } as SabnzbdConfig

    await manager().applyConfiguration(config)

    expect(callFor('servers', 'news.example.com')).toBeDefined()
  })

  test('never puts a server password in the request url', async () => {
    stubFetch()
    const config = {
      categories: [],
      servers: [
        {
          name: 'frugal',
          host: 'news.example.com',
          port: 563,
          username: 'u',
          password: 'super-secret',
          connections: 8,
          ssl: true,
          enable: true,
          priority: 0,
        },
      ],
    } as SabnzbdConfig

    await manager().applyConfiguration(config)

    for (const call of calls) {
      expect(call.url).not.toContain('super-secret')
    }
    expect(callFor('servers', 'frugal')?.get('password')).toBe('super-secret')
  })
})
