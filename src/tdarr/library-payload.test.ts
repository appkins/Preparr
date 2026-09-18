import { describe, expect, test } from 'bun:test'
import type { TdarrLibrary } from '@/config/schema'
import { desiredLibrary, newLibraryDocument } from './library-payload'

const movies = (overrides: Partial<TdarrLibrary> = {}): TdarrLibrary => ({
  name: 'Movies',
  folder: '/data/media/movies',
  variables: {},
  ...overrides,
})

describe('desiredLibrary', () => {
  test('carries the named fields and the passthrough ones, and nothing of its own', () => {
    const desired = desiredLibrary(
      movies({ cache: '/data/cache', folderWatching: true, scannerThreadCount: 4 } as TdarrLibrary),
    )

    expect(desired).toEqual({
      name: 'Movies',
      folder: '/data/media/movies',
      cache: '/data/cache',
      folderWatching: true,
      scannerThreadCount: 4,
    })
    expect('variables' in desired).toBe(false)
    expect('flow' in desired).toBe(false)
  })

  test('a flow becomes a flowId and switches the transcode mode to flows', () => {
    // Tdarr keeps four exclusive mode flags in decisionMaker; selecting a
    // flow in the UI clears them all and sets settingsFlows.
    const desired = desiredLibrary(movies({ flow: 'HEVC' }), 'flow1')

    expect(desired.flowId).toBe('flow1')
    expect(desired.decisionMaker).toEqual({
      settingsFlows: true,
      settingsPlugin: false,
      settingsVideo: false,
      settingsAudio: false,
    })
  })

  test('paths lose a trailing slash, as the server strips one on every start', () => {
    // main2 rewrites folder, cache and output through normJoinPath at boot,
    // so a declared "/x/" would differ from the stored "/x" forever after.
    const desired = desiredLibrary(movies({ folder: '/data/movies/', cache: '/data/cache/' }))

    expect(desired.folder).toBe('/data/movies')
    expect(desired.cache).toBe('/data/cache')
  })

  test('a bare root path is left alone', () => {
    expect(desiredLibrary(movies({ folder: '/' })).folder).toBe('/')
  })

  test('priority is included only when declared', () => {
    expect('priority' in desiredLibrary(movies())).toBe(false)
    expect(desiredLibrary(movies({ priority: 2 })).priority).toBe(2)
  })
})

describe('newLibraryDocument', () => {
  test('starts from Tdarr defaults so the server has every key it expects', () => {
    const doc = newLibraryDocument(movies(), { id: 'lib1', priority: 3 })

    expect(doc._id).toBe('lib1')
    expect(doc.priority).toBe(3)
    expect(doc.name).toBe('Movies')
    expect(doc.folder).toBe('/data/media/movies')
    expect(doc.container).toBe('.mkv')
    expect(doc.folderWatching).toBe(false)
    expect(doc.processLibrary).toBe(true)
    expect(Array.isArray(doc.pluginIDs)).toBe(true)
    expect(typeof doc.createdAt).toBe('number')
  })

  test('the schedule covers every hour of every day, spelled as Tdarr spells it', () => {
    const doc = newLibraryDocument(movies(), { id: 'lib1', priority: 0 })
    const schedule = doc.schedule as { _id: string; checked: boolean }[]

    expect(schedule).toHaveLength(7 * 24)
    expect(schedule[0]).toEqual({ _id: 'Sun:00-01', checked: true })
    expect(schedule[23]).toEqual({ _id: 'Sun:23-00', checked: true })
    // Thursday is "Thur", not "Thu"; anything else and the schedule UI shows
    // an empty column for it.
    expect(schedule.some((s) => s._id === 'Thur:12-13')).toBe(true)
  })

  test('declared values override the defaults, flow included', () => {
    const doc = newLibraryDocument(movies({ flow: 'HEVC', folderWatching: true }), {
      id: 'lib1',
      priority: 0,
      flowId: 'flow1',
    })
    const decisionMaker = doc.decisionMaker as Record<string, unknown>

    expect(doc.folderWatching).toBe(true)
    expect(doc.flowId).toBe('flow1')
    expect(decisionMaker.settingsFlows).toBe(true)
    expect(decisionMaker.settingsPlugin).toBe(false)
    // The rest of the default decisionMaker survives the merge.
    expect(decisionMaker.videoExcludeSwitch).toBe(true)
  })

  test('a declared priority beats the assigned one', () => {
    expect(newLibraryDocument(movies({ priority: 9 }), { id: 'x', priority: 1 }).priority).toBe(9)
  })
})
