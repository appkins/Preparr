import { describe, expect, test } from 'bun:test'
import { TrashGuide } from './guide'

function stubFetch(files: Record<string, unknown>) {
  const calls: string[] = []

  const fetchImpl = (url: string): Promise<Response> => {
    calls.push(url)

    if (url.includes('/contents/')) {
      const listing = Object.keys(files).map((name) => ({ name, type: 'file' }))
      return Promise.resolve(new Response(JSON.stringify(listing), { status: 200 }))
    }

    const name = url.split('/').pop() ?? ''
    const body = files[name]
    return Promise.resolve(
      body === undefined
        ? new Response('Not Found', { status: 404 })
        : new Response(JSON.stringify(body), { status: 200 }),
    )
  }

  return { fetchImpl, calls }
}

const files = {
  'aac.json': { trash_id: 'aaa', name: 'AAC', trash_scores: { default: 100 }, specifications: [] },
  'dts.json': { trash_id: 'bbb', name: 'DTS', trash_scores: { default: -100 }, specifications: [] },
}

describe('TrashGuide', () => {
  test('resolves a trash id to the guide definition', async () => {
    const { fetchImpl } = stubFetch(files)
    const guide = new TrashGuide({ app: 'radarr', fetchImpl })

    const resolved = await guide.resolve(['aaa'])

    expect(resolved.get('aaa')?.name).toBe('AAC')
  })

  test('builds the index once and reuses it', async () => {
    const { fetchImpl, calls } = stubFetch(files)
    const guide = new TrashGuide({ app: 'radarr', fetchImpl })

    await guide.resolve(['aaa'])
    const after = calls.length
    await guide.resolve(['bbb'])

    expect(calls.length).toBe(after)
  })

  test('reads the directory for the app it was built for', async () => {
    const { fetchImpl, calls } = stubFetch(files)
    await new TrashGuide({ app: 'sonarr', fetchImpl }).resolve(['aaa'])

    expect(calls[0]).toContain('/sonarr/cf')
    expect(calls[0]).not.toContain('/radarr/cf')
  })

  test('names a trash id the guide does not define', async () => {
    const { fetchImpl } = stubFetch(files)
    const guide = new TrashGuide({ app: 'radarr', fetchImpl })

    // Silently skipping would leave the format unscored and the profile
    // quietly wrong, which is the failure this is meant to prevent.
    await expect(guide.resolve(['nope'])).rejects.toThrow(/nope/)
  })

  test('asks for nothing at all when given no ids', async () => {
    const { fetchImpl, calls } = stubFetch(files)
    await new TrashGuide({ app: 'radarr', fetchImpl }).resolve([])

    expect(calls).toHaveLength(0)
  })
})
