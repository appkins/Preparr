import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { ProwlarrExtrasClient } from './client'

type Call = { method: string; path: string; body: Record<string, unknown> | undefined }

const realFetch = globalThis.fetch
let calls: Call[]

/** Routes GET/POST/PUT by path against canned state, recording every call. */
function stubApi(state: { tag?: unknown[]; indexerproxy?: unknown[]; indexer?: unknown[] }) {
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    const path = url.pathname.replace('/api/v1/', '')
    const method = init?.method ?? 'GET'
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined

    calls.push({ method, path, body })

    if (method === 'GET') {
      const key = path as keyof typeof state
      return new Response(JSON.stringify(state[key] ?? []), { status: 200 })
    }

    return Promise.resolve(new Response(JSON.stringify({ id: 99, ...body }), { status: 200 }))
  }) as typeof fetch
}

function client() {
  return new ProwlarrExtrasClient({ url: 'http://prowlarr:9696', apiKey: 'k'.repeat(32) })
}

beforeEach(() => {
  calls = []
})

afterEach(() => {
  globalThis.fetch = realFetch
})

describe('ProwlarrExtrasClient.ensureTags', () => {
  test('creates only the labels that do not exist', async () => {
    stubApi({ tag: [{ id: 1, label: 'existing' }] })

    await client().ensureTags(['existing', 'brand-new'])

    const posts = calls.filter((c) => c.method === 'POST')
    expect(posts).toHaveLength(1)
    expect(posts[0]?.body?.label).toBe('brand-new')
  })

  test('matches existing labels case-insensitively', async () => {
    stubApi({ tag: [{ id: 1, label: 'FlareSolverr' }] })

    await client().ensureTags(['flaresolverr'])

    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0)
  })

  test('returns a lowercased label to id map including newly created tags', async () => {
    stubApi({ tag: [{ id: 1, label: 'Existing' }] })

    const ids = await client().ensureTags(['existing', 'fresh'])

    expect(ids.existing).toBe(1)
    expect(ids.fresh).toBe(99)
  })

  test('never posts a tag id, which prowlarr rejects', async () => {
    stubApi({ tag: [] })

    await client().ensureTags(['one'])

    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ label: 'one' })
  })
})

describe('ProwlarrExtrasClient.syncIndexerProxies', () => {
  const proxy = {
    name: 'FlareSolverr',
    implementation: 'FlareSolverr',
    implementationName: 'FlareSolverr',
    configContract: 'FlareSolverrSettings',
    fields: [{ name: 'host', value: 'http://flaresolverr:8191/' }],
    tags: ['flaresolverr'],
  }

  test('creates a proxy that does not exist, with resolved tag ids', async () => {
    stubApi({ indexerproxy: [] })

    const result = await client().syncIndexerProxies([proxy], { flaresolverr: 7 })

    const post = calls.find((c) => c.method === 'POST')
    expect(post?.path).toBe('indexerproxy')
    expect(post?.body?.tags).toEqual([7])
    expect(result.created).toEqual(['FlareSolverr'])
  })

  test('leaves an unchanged proxy alone', async () => {
    stubApi({
      indexerproxy: [{ id: 3, ...proxy, tags: [7] }],
    })

    const result = await client().syncIndexerProxies([proxy], { flaresolverr: 7 })

    expect(calls.filter((c) => c.method !== 'GET')).toHaveLength(0)
    expect(result.updated).toEqual([])
  })

  test('updates a changed proxy while preserving fields it does not manage', async () => {
    stubApi({
      indexerproxy: [
        {
          id: 3,
          ...proxy,
          tags: [7],
          fields: [
            { name: 'host', value: 'http://old:8191/' },
            { name: 'requestTimeout', value: 60 },
          ],
        },
      ],
    })

    const result = await client().syncIndexerProxies([proxy], { flaresolverr: 7 })

    const put = calls.find((c) => c.method === 'PUT')
    expect(put?.path).toBe('indexerproxy/3')
    const fields = put?.body?.fields as Array<{ name: string; value: unknown }>
    expect(fields.find((f) => f.name === 'host')?.value).toBe('http://flaresolverr:8191/')
    // A PUT replaces the resource wholesale, so anything unmanaged has to be
    // carried across or it is silently dropped.
    expect(fields.find((f) => f.name === 'requestTimeout')?.value).toBe(60)
    expect(result.updated).toEqual(['FlareSolverr'])
  })

  test('drops tag labels that have no id rather than sending null', async () => {
    stubApi({ indexerproxy: [] })

    await client().syncIndexerProxies([{ ...proxy, tags: ['flaresolverr', 'unknown'] }], {
      flaresolverr: 7,
    })

    expect(calls.find((c) => c.method === 'POST')?.body?.tags).toEqual([7])
  })
})

describe('ProwlarrExtrasClient.syncIndexerTags', () => {
  test('adds the resolved ids to an existing indexer', async () => {
    stubApi({ indexer: [{ id: 5, name: 'Nyaa.si', tags: [] }] })

    const result = await client().syncIndexerTags(
      { 'Nyaa.si': ['flaresolverr'] },
      { flaresolverr: 7 },
    )

    const put = calls.find((c) => c.method === 'PUT')
    expect(put?.path).toBe('indexer/5')
    expect(put?.body?.tags).toEqual([7])
    expect(result.tagged).toEqual(['Nyaa.si'])
  })

  test('keeps tags added outside this config', async () => {
    stubApi({ indexer: [{ id: 5, name: 'Nyaa.si', tags: [2] }] })

    await client().syncIndexerTags({ 'Nyaa.si': ['flaresolverr'] }, { flaresolverr: 7 })

    expect(calls.find((c) => c.method === 'PUT')?.body?.tags).toEqual([2, 7])
  })

  test('does nothing when the indexer already carries the tag', async () => {
    stubApi({ indexer: [{ id: 5, name: 'Nyaa.si', tags: [7] }] })

    const result = await client().syncIndexerTags(
      { 'Nyaa.si': ['flaresolverr'] },
      { flaresolverr: 7 },
    )

    expect(calls.filter((c) => c.method !== 'GET')).toHaveLength(0)
    expect(result.tagged).toEqual([])
  })

  test('skips an indexer that does not exist yet', async () => {
    stubApi({ indexer: [] })

    const result = await client().syncIndexerTags(
      { Missing: ['flaresolverr'] },
      { flaresolverr: 7 },
    )

    expect(calls.filter((c) => c.method !== 'GET')).toHaveLength(0)
    expect(result.skipped).toEqual(['Missing'])
  })
})
