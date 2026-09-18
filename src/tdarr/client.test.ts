import { describe, expect, test } from 'bun:test'
import { TdarrClient } from './client'

interface Call {
  url: string
  method: string
  headers: Record<string, string>
  body: unknown
}

function stub(respond: (call: Call) => Response | undefined) {
  const calls: Call[] = []
  const fetchImpl = ((input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const headers = Object.fromEntries(
      Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [
        k.toLowerCase(),
        v,
      ]),
    )
    const call: Call = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    }
    calls.push(call)
    return Promise.resolve(respond(call) ?? new Response('', { status: 200 }))
  }) as typeof fetch
  return { fetchImpl, calls }
}

const json = (value: unknown) =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

describe('TdarrClient', () => {
  test('sends the api key in the header Tdarr reads it from', async () => {
    const { fetchImpl, calls } = stub(() => json({ status: 'good', version: '2.45.01' }))
    const client = new TdarrClient({ url: 'http://tdarr:8265/', apiKey: 'tapi_x', fetchImpl })

    await client.status()

    expect(calls[0]?.url).toBe('http://tdarr:8265/api/v2/status')
    expect(calls[0]?.headers['x-api-key']).toBe('tapi_x')
  })

  test('sends no key header when there is no key', async () => {
    // With auth off Tdarr ignores the header, but an empty one would be read
    // as a key of "" once auth is turned on and refused.
    const { fetchImpl, calls } = stub(() => json({ status: 'good' }))
    await new TdarrClient({ url: 'http://tdarr:8265', fetchImpl }).status()

    expect(calls[0]?.headers['x-api-key']).toBeUndefined()
  })

  test('wraps database calls in the data envelope cruddb expects', async () => {
    const { fetchImpl, calls } = stub(() => json([{ _id: 'lib1', name: 'Movies' }]))
    const client = new TdarrClient({ url: 'http://tdarr:8265', fetchImpl })

    const libraries = await client.getAll('LibrarySettingsJSONDB')

    expect(calls[0]?.url).toBe('http://tdarr:8265/api/v2/cruddb')
    expect(calls[0]?.method).toBe('POST')
    expect(calls[0]?.body).toEqual({
      data: { collection: 'LibrarySettingsJSONDB', mode: 'getAll' },
    })
    expect(libraries).toEqual([{ _id: 'lib1', name: 'Movies' }])
  })

  test('reads a missing document as undefined, which Tdarr answers with an empty body', async () => {
    const { fetchImpl } = stub(() => new Response('', { status: 200 }))
    const client = new TdarrClient({ url: 'http://tdarr:8265', fetchImpl })

    expect(await client.getById('FlowsJSONDB', 'nope')).toBeUndefined()
  })

  test('insert names the document and update carries only the changed keys', async () => {
    const { fetchImpl, calls } = stub(() => new Response('', { status: 200 }))
    const client = new TdarrClient({ url: 'http://tdarr:8265', fetchImpl })

    await client.insert('FlowsJSONDB', 'flow1', { name: 'HEVC' })
    await client.update('FlowsJSONDB', 'flow1', { priority: 2 })

    expect(calls[0]?.body).toEqual({
      data: { collection: 'FlowsJSONDB', mode: 'insert', docID: 'flow1', obj: { name: 'HEVC' } },
    })
    expect(calls[1]?.body).toEqual({
      data: { collection: 'FlowsJSONDB', mode: 'update', docID: 'flow1', obj: { priority: 2 } },
    })
  })

  test('raises on a non-2xx answer with the status in the message', async () => {
    const { fetchImpl } = stub(() => new Response('Forbidden', { status: 403 }))
    const client = new TdarrClient({ url: 'http://tdarr:8265', fetchImpl })

    await expect(client.getAll('ApiKeysJSONDB')).rejects.toThrow(/403/)
  })

  test('ping proves the key by reading a collection, not just the public status', async () => {
    // /status answers without a key even when auth is on, so it proves the
    // server is up and nothing else.
    const { fetchImpl, calls } = stub((call) =>
      call.url.endsWith('/cruddb') ? new Response('Unauthorized', { status: 401 }) : json({}),
    )
    const client = new TdarrClient({ url: 'http://tdarr:8265', apiKey: 'bad', fetchImpl })

    expect(await client.ping()).toBe(false)
    expect(calls.some((c) => c.url.endsWith('/cruddb'))).toBe(true)
  })

  test('node and library actions use their own endpoints', async () => {
    const { fetchImpl, calls } = stub((call) =>
      call.url.endsWith('/get-nodes') ? json({ n1: { _id: 'n1', nodeName: 'otter' } }) : undefined,
    )
    const client = new TdarrClient({ url: 'http://tdarr:8265', fetchImpl })

    const nodes = await client.getNodes()
    await client.updateNode('n1', { nodePaused: true })
    await client.toggleFolderWatch('lib1', '/data/movies', true)
    await client.scanFiles('lib1', 'scanFindNew', '/data/movies')

    expect(nodes.n1?.nodeName).toBe('otter')
    expect(calls[1]?.url).toBe('http://tdarr:8265/api/v2/update-node')
    expect(calls[1]?.body).toEqual({ data: { nodeID: 'n1', nodeUpdates: { nodePaused: true } } })
    expect(calls[2]?.body).toEqual({
      data: { auto: false, folder: '/data/movies', dbID: 'lib1', status: true },
    })
    expect(calls[3]?.body).toEqual({
      data: { scanConfig: { dbID: 'lib1', mode: 'scanFindNew', arrayOrPath: '/data/movies' } },
    })
  })
})

describe('environment mapping', () => {
  test('TDARR_URL and TDARR_API_KEY reach services.tdarr', async () => {
    // The client is only ever built from config.services.tdarr, so without
    // these the steps would skip silently -- the same omission Pulsarr had.
    const { envMapping } = await import('@/config/defaults')

    expect(envMapping.TDARR_URL).toBe('services.tdarr.url')
    expect(envMapping.TDARR_API_KEY).toBe('services.tdarr.apiKey')
  })
})
