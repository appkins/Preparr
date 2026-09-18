import { describe, expect, test } from 'bun:test'
import type { Config, TdarrConfig } from '@/config/schema'
import type { StepContext } from '@/core/step'
import type { TdarrClient } from '@/tdarr/client'
import { TdarrLibrariesStep } from './tdarr-libraries'

interface Written {
  collection: string
  mode: string
  id: string
  obj?: Record<string, unknown>
}

function fakeClient(state: {
  libraries?: Record<string, unknown>[]
  flows?: Record<string, unknown>[]
  variables?: Record<string, unknown>[]
}) {
  const written: Written[] = []
  const actions: string[] = []
  const collections: Record<string, Record<string, unknown>[]> = {
    LibrarySettingsJSONDB: state.libraries ?? [],
    FlowsJSONDB: state.flows ?? [],
    VariablesJSONDB: state.variables ?? [],
  }
  const client = {
    getAll: (collection: string) => Promise.resolve(collections[collection] ?? []),
    insert: (collection: string, id: string, obj: Record<string, unknown>) => {
      written.push({ collection, mode: 'insert', id, obj })
      collections[collection]?.push({ ...obj, _id: id })
      return Promise.resolve()
    },
    update: (collection: string, id: string, obj: Record<string, unknown>) => {
      written.push({ collection, mode: 'update', id, obj })
      const doc = collections[collection]?.find((d) => d._id === id)
      if (doc) Object.assign(doc, obj)
      return Promise.resolve()
    },
    toggleFolderWatch: (id: string, folder: string, status: boolean) => {
      actions.push(`watch:${id}:${folder}:${status}`)
      return Promise.resolve()
    },
    scanFiles: (id: string, mode: string, path: string) => {
      actions.push(`scan:${id}:${mode}:${path}`)
      return Promise.resolve()
    },
  } as unknown as TdarrClient

  return { client, written, actions }
}

function contextWith(tdarr: Partial<TdarrConfig> | undefined, client?: TdarrClient): StepContext {
  const config = tdarr
    ? { settings: {}, variables: {}, flows: [], libraries: [], nodes: [], ...tdarr }
    : undefined
  return {
    config: { app: { tdarr: config } } as unknown as Config,
    servarrType: 'tdarr',
    executionMode: 'sidecar',
    tdarrClient: client,
  } as unknown as StepContext
}

const storedFlow = { _id: 'hevc10Bit', name: 'HEVC 10-bit', flowPlugins: [], flowEdges: [] }

const storedMovies = {
  _id: 'P_YOPgtJE',
  name: 'Movies',
  folder: '/data/media/movies',
  cache: '/data/cache',
  folderWatching: true,
  priority: 0,
  flowId: 'hevc10Bit',
  decisionMaker: {
    settingsPlugin: false,
    settingsFlows: true,
    settingsVideo: false,
    settingsAudio: false,
    videoExcludeSwitch: true,
  },
  scannerThreadCount: 2,
}

describe('TdarrLibrariesStep', () => {
  test('skips without a client or without libraries', () => {
    const step = new TdarrLibrariesStep()
    const { client } = fakeClient({})

    expect(step.validatePrerequisites(contextWith({ libraries: [] }))).toBe(false)
    expect(step.validatePrerequisites(contextWith({ libraries: [] }, client))).toBe(false)
    expect(
      step.validatePrerequisites(
        contextWith({ libraries: [{ name: 'Movies', folder: '/x', variables: {} }] }, client),
      ),
    ).toBe(true)
  })

  test('a library that already says what was asked for plans no change', async () => {
    const { client } = fakeClient({ libraries: [storedMovies], flows: [storedFlow] })
    const step = new TdarrLibrariesStep()
    const context = contextWith(
      {
        libraries: [
          {
            name: 'Movies',
            folder: '/data/media/movies',
            cache: '/data/cache',
            flow: 'HEVC 10-bit',
            folderWatching: true,
            variables: {},
          },
        ],
      },
      client,
    )

    const changes = await step.compareAndPlan(
      await step.readCurrentState(context),
      step.getDesiredState(context),
      context,
    )

    expect(changes).toEqual([])
  })

  test('creates a missing library from defaults, resolves its flow, watches and scans it', async () => {
    const { client, written, actions } = fakeClient({ flows: [storedFlow] })
    const step = new TdarrLibrariesStep()
    const context = contextWith(
      {
        libraries: [
          {
            name: 'TV',
            folder: '/data/media/tv',
            flow: 'hevc10Bit',
            folderWatching: true,
            variables: { sonarrApiKey: 'k' },
          },
        ],
      },
      client,
    )

    const result = await step.execute(context)

    expect(result.success).toBe(true)
    expect(result.changes.map((c) => `${c.type}:${c.resource}:${c.identifier}`)).toEqual([
      'create:tdarr-library:TV',
      'create:tdarr-library-variable:TV/sonarrApiKey',
    ])

    const insert = written.find((w) => w.collection === 'LibrarySettingsJSONDB')
    expect(insert?.mode).toBe('insert')
    expect(insert?.obj?.name).toBe('TV')
    expect(insert?.obj?.flowId).toBe('hevc10Bit')
    expect(insert?.obj?.container).toBe('.mkv')
    expect(insert?.obj?.priority).toBe(0)

    const id = insert?.id ?? ''
    expect(actions).toEqual([
      `watch:${id}:/data/media/tv:true`,
      `scan:${id}:scanFindNew:/data/media/tv`,
    ])

    const variable = written.find((w) => w.collection === 'VariablesJSONDB')
    expect(variable?.obj).toMatchObject({ key: 'sonarrApiKey', value: 'k', type: `library:${id}` })
  })

  test('updates only the keys that differ and re-toggles the watcher when watching changes', async () => {
    const { client, written, actions } = fakeClient({
      libraries: [storedMovies],
      flows: [storedFlow],
    })
    const step = new TdarrLibrariesStep()
    const context = contextWith(
      {
        libraries: [
          {
            name: 'Movies',
            folder: '/data/media/movies',
            folderWatching: false,
            scannerThreadCount: 4,
            variables: {},
          } as TdarrConfig['libraries'][number],
        ],
      },
      client,
    )

    const result = await step.execute(context)

    expect(result.success).toBe(true)
    expect(written).toEqual([
      {
        collection: 'LibrarySettingsJSONDB',
        mode: 'update',
        id: 'P_YOPgtJE',
        obj: { folderWatching: false, scannerThreadCount: 4 },
      },
    ])
    expect(actions).toEqual(['watch:P_YOPgtJE:/data/media/movies:false'])
  })

  test('a flow that does not exist is a failure for that library, not a silent default', async () => {
    const { client, written } = fakeClient({ flows: [storedFlow] })
    const step = new TdarrLibrariesStep()
    const context = contextWith(
      { libraries: [{ name: 'TV', folder: '/data/tv', flow: 'Missing', variables: {} }] },
      client,
    )

    const result = await step.execute(context)

    expect(result.success).toBe(false)
    expect(result.errors[0]?.message).toMatch(/Missing/)
    expect(written).toEqual([])
  })

  test('a new library takes the next free priority', async () => {
    const { client, written } = fakeClient({ libraries: [storedMovies] })
    const step = new TdarrLibrariesStep()
    const context = contextWith(
      { libraries: [{ name: 'TV', folder: '/data/tv', variables: {} }] },
      client,
    )

    await step.execute(context)

    expect(written[0]?.obj?.priority).toBe(1)
  })
})
