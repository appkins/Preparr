import { describe, expect, test } from 'bun:test'
import { LazyLibrarianClient } from './client'

function stub(responses: Record<string, string>) {
  const calls: URL[] = []
  const fetchImpl = (url: string): Promise<Response> => {
    const parsed = new URL(url)
    calls.push(parsed)
    const cmd = parsed.searchParams.get('cmd') ?? ''
    const name = parsed.searchParams.get('name') ?? ''
    return Promise.resolve(
      new Response(responses[`${cmd}:${name}`] ?? responses[cmd] ?? '', { status: 200 }),
    )
  }
  return { fetchImpl, calls }
}

const options = { url: 'http://lazylibrarian:5299', apiKey: 'k' }

describe('LazyLibrarianClient', () => {
  test('reads a setting, unwrapping the brackets the API puts round it', async () => {
    // readCFG answers f"[{value}]" -- the brackets are formatting, not data.
    const { fetchImpl } = stub({ 'readCFG:EBOOK_DIR': '[/data/media/books]' })
    const client = new LazyLibrarianClient({ ...options, fetchImpl })

    expect(await client.read('General', 'EBOOK_DIR')).toBe('/data/media/books')
  })

  test('reads an empty setting as empty rather than as the literal brackets', async () => {
    const { fetchImpl } = stub({ 'readCFG:AUDIO_DIR': '[]' })
    const client = new LazyLibrarianClient({ ...options, fetchImpl })

    expect(await client.read('General', 'AUDIO_DIR')).toBe('')
  })

  test('sends the api key and the command', async () => {
    const { fetchImpl, calls } = stub({ 'readCFG:X': '[y]' })
    await new LazyLibrarianClient({ ...options, fetchImpl }).read('General', 'X')

    expect(calls[0]?.searchParams.get('apikey')).toBe('k')
    expect(calls[0]?.searchParams.get('cmd')).toBe('readCFG')
    expect(calls[0]?.searchParams.get('group')).toBe('General')
  })

  test('treats an unknown setting as an error, though the API answers 200', async () => {
    // Every failure comes back as prose with a 200 status, so the body is the
    // only thing that says whether it worked.
    const { fetchImpl } = stub({ readCFG: 'No config entry for General: NOPE' })
    const client = new LazyLibrarianClient({ ...options, fetchImpl })

    await expect(client.read('General', 'NOPE')).rejects.toThrow(/NOPE/)
  })

  test('treats a missing parameter as an error', async () => {
    const { fetchImpl } = stub({ writeCFG: 'Missing parameter: value' })
    const client = new LazyLibrarianClient({ ...options, fetchImpl })

    await expect(client.write('General', 'X', 'y')).rejects.toThrow(/Missing parameter/)
  })

  test('treats "not found in config" on write as an error', async () => {
    const { fetchImpl } = stub({ writeCFG: 'MADE_UP not found in config' })
    const client = new LazyLibrarianClient({ ...options, fetchImpl })

    await expect(client.write('General', 'MADE_UP', 'y')).rejects.toThrow(/not found in config/)
  })

  test('accepts an empty body as success, which is what a write returns', async () => {
    const { fetchImpl } = stub({ writeCFG: '' })
    const client = new LazyLibrarianClient({ ...options, fetchImpl })

    await expect(client.write('General', 'X', 'y')).resolves.toBeUndefined()
  })

  test('writes only the settings that differ', async () => {
    const { fetchImpl, calls } = stub({
      'readCFG:EBOOK_DIR': '[/data/media/books]',
      'readCFG:AUDIO_DIR': '[/wrong]',
      writeCFG: '',
    })
    const client = new LazyLibrarianClient({ ...options, fetchImpl })

    const changed = await client.apply({
      General: { EBOOK_DIR: '/data/media/books', AUDIO_DIR: '/data/media/audio' },
    })

    expect(changed).toEqual(['General.AUDIO_DIR'])
    const writes = calls.filter((c) => c.searchParams.get('cmd') === 'writeCFG')
    expect(writes).toHaveLength(1)
    expect(writes[0]?.searchParams.get('name')).toBe('AUDIO_DIR')
    expect(writes[0]?.searchParams.get('value')).toBe('/data/media/audio')
  })

  test('writes nothing at all when everything already matches', async () => {
    const { fetchImpl, calls } = stub({ 'readCFG:EBOOK_DIR': '[/x]' })
    const client = new LazyLibrarianClient({ ...options, fetchImpl })

    expect(await client.apply({ General: { EBOOK_DIR: '/x' } })).toEqual([])
    expect(calls.filter((c) => c.searchParams.get('cmd') === 'writeCFG')).toHaveLength(0)
  })
})
