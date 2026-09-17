import type { Mock } from 'bun:test'
import { afterEach, describe, expect, mock, test } from 'bun:test'
import { BazarrManager } from './client'

describe('BazarrManager language profile configuration', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
    mock.restore()
  })

  test('restarts Bazarr after creating the first language profiles', async () => {
    let restarted = false
    const fetchMock = mock((input: RequestInfo | URL) => {
      const url = input.toString()

      if (url.includes('/api/system/languages/profiles')) {
        // After restart, return the created profile to simulate cache reload
        const data = restarted
          ? [
              {
                profileId: 1,
                name: 'Default',
                cutoff: 1,
                items: [],
                mustContain: '',
                mustNotContain: '',
                originalFormat: null,
                tag: null,
              },
            ]
          : []
        return Promise.resolve(new Response(JSON.stringify(data), { status: 200 }))
      }

      if (url.includes('/api/system/settings')) {
        return Promise.resolve(new Response('', { status: 204 }))
      }

      if (url.includes('/api/system?action=restart')) {
        restarted = true
        return Promise.resolve(new Response('', { status: 204 }))
      }

      if (url.includes('/api/system/status')) {
        return Promise.resolve(
          new Response(JSON.stringify({ data: { bazarr_version: '1.5.5' } }), { status: 200 }),
        )
      }

      throw new Error(`Unexpected fetch: ${url}`)
    }) as Mock<typeof fetch>

    globalThis.fetch = fetchMock as typeof fetch

    const manager = new BazarrManager({
      url: 'http://bazarr:6767',
      apiKey: '0123456789abcdef0123456789abcdef',
    })

    await manager.configureLanguageProfiles([
      {
        name: 'Default',
        cutoff: 1,
        items: [{ language: 'en' }, { language: 'nl', hi: true }],
      },
    ])

    const calledUrls = fetchMock.mock.calls.map(([input]) => input.toString())

    expect(calledUrls).toContain(
      'http://bazarr:6767/api/system?action=restart&apikey=0123456789abcdef0123456789abcdef',
    )
    // Verify language profiles were checked AFTER the restart
    const restartIndex = calledUrls.findIndex((url) => url.includes('/api/system?action=restart'))
    const profileCallIndexes = calledUrls
      .map((url, index) => ({ url, index }))
      .filter(({ url }) => url.includes('/api/system/languages/profiles'))
      .map(({ index }) => index)

    expect(profileCallIndexes.length).toBeGreaterThanOrEqual(2)
    expect(profileCallIndexes.some((index) => index > restartIndex)).toBe(true)
  })

  test('does not restart Bazarr when language profiles already exist', async () => {
    const fetchMock = mock((input: RequestInfo | URL) => {
      const url = input.toString()

      if (url.includes('/api/system/languages/profiles')) {
        return Promise.resolve(
          new Response(
            JSON.stringify([
              {
                profileId: 1,
                name: 'Default',
                cutoff: 1,
                items: [],
                mustContain: '',
                mustNotContain: '',
                originalFormat: null,
                tag: null,
              },
            ]),
            { status: 200 },
          ),
        )
      }

      if (url.includes('/api/system/settings')) {
        return Promise.resolve(new Response('', { status: 204 }))
      }

      throw new Error(`Unexpected fetch: ${url}`)
    }) as Mock<typeof fetch>

    globalThis.fetch = fetchMock as typeof fetch

    const manager = new BazarrManager({
      url: 'http://bazarr:6767',
      apiKey: '0123456789abcdef0123456789abcdef',
    })

    await manager.configureLanguageProfiles([
      {
        name: 'Default',
        cutoff: 1,
        items: [{ language: 'en' }],
      },
    ])

    const calledUrls = fetchMock.mock.calls.map(([input]) => input.toString())
    expect(calledUrls.some((url) => url.includes('/api/system?action=restart'))).toBe(false)
  })
})

describe('BazarrManager language profile reads', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
    mock.restore()
  })

  test('mustContain comes back as a string even when Bazarr sends a list', async () => {
    // Bazarr answers /system/languages/profiles with "mustContain": [] where
    // the type here says string. getLanguageProfiles casts the response
    // instead of reading it, so the array survives, and the profile step
    // compares it with `current.mustContain !== (desired.mustContain ?? '')`.
    // [] !== '' is always true, so the step plans an update on every pass and
    // never converges -- it rewrites an already-correct profile forever.
    globalThis.fetch = mock(
      () =>
        Promise.resolve(
          new Response(
            JSON.stringify([
              {
                profileId: 1,
                name: 'English',
                cutoff: null,
                items: [
                  {
                    id: 1,
                    language: 'en',
                    forced: 'False',
                    hi: 'False',
                    audio_exclude: 'True',
                    audio_only_include: 'False',
                  },
                ],
                mustContain: [],
                mustNotContain: [],
                originalFormat: 0,
                tag: null,
              },
            ]),
            { status: 200 },
          ),
        ),
      // biome-ignore lint/suspicious/noExplicitAny: a fetch stub, not a fetch
    ) as any

    const client = new BazarrManager({ url: 'http://bazarr:6767', apiKey: 'k' })
    const [profile] = await client.getLanguageProfiles()

    expect(profile.mustContain).toBe('')
    expect(profile.mustNotContain).toBe('')
  })

  test('a populated list becomes the comma-separated form the write path sends', async () => {
    globalThis.fetch = mock(
      () =>
        Promise.resolve(
          new Response(
            JSON.stringify([
              { profileId: 1, name: 'English', cutoff: null, items: [], mustContain: ['x', 'y'] },
            ]),
            { status: 200 },
          ),
        ),
      // biome-ignore lint/suspicious/noExplicitAny: a fetch stub, not a fetch
    ) as any

    const client = new BazarrManager({ url: 'http://bazarr:6767', apiKey: 'k' })
    const [profile] = await client.getLanguageProfiles()

    expect(profile.mustContain).toBe('x,y')
  })
})
