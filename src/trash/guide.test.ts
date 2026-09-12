import { describe, expect, test } from 'bun:test'
import { TrashGuide } from './guide'

function stubFetch(files: Record<string, unknown>, app = 'radarr') {
  const calls: string[] = []

  const fetchImpl = (url: string): Promise<Response> => {
    calls.push(url)

    if (url.includes('data.jsdelivr.com')) {
      // The listing covers the whole repository, not one directory.
      const listing = {
        files: [
          { name: '/docs/README.md' },
          ...Object.keys(files).map((name) => ({ name: `/docs/json/${app}/cf/${name}` })),
        ],
      }
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

  test('takes only the files belonging to the app it was built for', async () => {
    const { fetchImpl, calls } = stubFetch(files, 'sonarr')
    await new TrashGuide({ app: 'sonarr', fetchImpl }).resolve(['aaa'])

    const fetched = calls.filter((url) => url.includes('cdn.jsdelivr.net'))
    expect(fetched.every((url) => url.includes('/sonarr/cf/'))).toBe(true)
    expect(fetched).toHaveLength(Object.keys(files).length)
  })

  test('does not use the GitHub API, whose unauthenticated budget is 60 an hour', async () => {
    const { fetchImpl, calls } = stubFetch(files)
    await new TrashGuide({ app: 'radarr', fetchImpl }).resolve(['aaa'])

    expect(calls.some((url) => url.includes('api.github.com'))).toBe(false)
  })

  test('names a trash id the guide does not define', async () => {
    const { fetchImpl } = stubFetch(files)
    const guide = new TrashGuide({ app: 'radarr', fetchImpl })

    // Silently skipping would leave the format unscored and the profile
    // quietly wrong, which is the failure this is meant to prevent.
    await expect(guide.resolve(['nope'])).rejects.toThrow(/nope/)
  })

  test('indexes the rest when a listed file cannot be fetched', async () => {
    // jsDelivr lists files its CDN then 404s. One of those must not cost the
    // whole index -- an id that actually matters still fails loudly below.
    const withGhost = { ...files, 'ghost.json': undefined as unknown }
    const { fetchImpl } = stubFetch(withGhost)
    const guide = new TrashGuide({ app: 'radarr', fetchImpl })

    const resolved = await guide.resolve(['aaa', 'bbb'])

    expect(resolved.get('aaa')?.name).toBe('AAC')
    expect(resolved.get('bbb')?.name).toBe('DTS')
  })

  test('still reports an id whose file was the one that failed', async () => {
    const { fetchImpl } = stubFetch({ ...files, 'ghost.json': undefined as unknown })
    const guide = new TrashGuide({ app: 'radarr', fetchImpl })

    await expect(guide.resolve(['ccc'])).rejects.toThrow(/ccc/)
  })

  test('asks for nothing at all when given no ids', async () => {
    const { fetchImpl, calls } = stubFetch(files)
    await new TrashGuide({ app: 'radarr', fetchImpl }).resolve([])

    expect(calls).toHaveLength(0)
  })
})
