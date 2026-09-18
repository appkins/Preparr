import { describe, expect, test } from 'bun:test'
import type { Config, TdarrConfig } from '@/config/schema'
import type { StepContext } from '@/core/step'
import type { TdarrClient } from '@/tdarr/client'
import { TdarrNodesStep } from './tdarr-nodes'

function fakeClient(state: {
  connected?: Record<string, Record<string, unknown>>
  stored?: Record<string, unknown>[]
  libraries?: Record<string, unknown>[]
}) {
  const nodeUpdates: { nodeID: string; updates: Record<string, unknown> }[] = []
  const written: { mode: string; id: string; obj: Record<string, unknown> }[] = []
  const client = {
    getNodes: () => Promise.resolve(state.connected ?? {}),
    getAll: (collection: string) =>
      Promise.resolve(collection === 'NodeJSONDB' ? (state.stored ?? []) : (state.libraries ?? [])),
    updateNode: (nodeID: string, updates: Record<string, unknown>) => {
      nodeUpdates.push({ nodeID, updates })
      return Promise.resolve()
    },
    insert: (_c: string, id: string, obj: Record<string, unknown>) => {
      written.push({ mode: 'insert', id, obj })
      return Promise.resolve()
    },
    update: (_c: string, id: string, obj: Record<string, unknown>) => {
      written.push({ mode: 'update', id, obj })
      return Promise.resolve()
    },
  } as unknown as TdarrClient
  return { client, nodeUpdates, written }
}

function contextWith(nodes: TdarrConfig['nodes'], client?: TdarrClient): StepContext {
  return {
    config: {
      app: { tdarr: { settings: {}, variables: {}, flows: [], libraries: [], nodes } },
    } as unknown as Config,
    servarrType: 'tdarr',
    executionMode: 'sidecar',
    tdarrClient: client,
  } as unknown as StepContext
}

const limits = { healthcheckcpu: 1, healthcheckgpu: 0, transcodecpu: 1, transcodegpu: 0 }

const connectedOtter = {
  wyE0mXKHH: {
    _id: 'wyE0mXKHH',
    nodeName: 'our-otter',
    workerLimits: limits,
    nodePaused: false,
    librariesToNotProcess: {},
  },
}

describe('TdarrNodesStep', () => {
  test('a connected node that matches plans nothing', async () => {
    const { client } = fakeClient({ connected: connectedOtter })
    const step = new TdarrNodesStep()
    const context = contextWith(
      [{ name: 'our-otter', workerLimits: { transcodecpu: 1 }, nodePaused: false }],
      client,
    )

    const changes = await step.compareAndPlan(
      await step.readCurrentState(context),
      step.getDesiredState(context),
      context,
    )

    expect(changes).toEqual([])
  })

  test('a connected node is updated live, by its id', async () => {
    const { client, nodeUpdates, written } = fakeClient({ connected: connectedOtter })
    const step = new TdarrNodesStep()

    const result = await step.execute(
      contextWith([{ name: 'our-otter', workerLimits: { transcodecpu: 3 } }], client),
    )

    expect(result.success).toBe(true)
    expect(nodeUpdates).toEqual([
      { nodeID: 'wyE0mXKHH', updates: { workerLimits: { ...limits, transcodecpu: 3 } } },
    ])
    expect(written).toEqual([])
  })

  test('a node that is not connected is configured in its stored record instead', async () => {
    // NodeJSONDB is keyed by node name and read back on registration, so a
    // node that is down still ends up with the limits it was given.
    const { client, nodeUpdates, written } = fakeClient({
      stored: [{ _id: 'gpu-node', workerLimits: limits, nodePaused: false }],
    })
    const step = new TdarrNodesStep()

    const result = await step.execute(contextWith([{ name: 'gpu-node', nodePaused: true }], client))

    expect(result.success).toBe(true)
    expect(nodeUpdates).toEqual([])
    expect(written).toEqual([{ mode: 'update', id: 'gpu-node', obj: { nodePaused: true } }])
  })

  test('a node the server has never seen is seeded with defaults under its name', async () => {
    const { client, written } = fakeClient({})
    const step = new TdarrNodesStep()

    await step.execute(
      contextWith([{ name: 'gpu-node', workerLimits: { transcodegpu: 1 } }], client),
    )

    expect(written).toHaveLength(1)
    expect(written[0]?.mode).toBe('insert')
    expect(written[0]?.id).toBe('gpu-node')
    expect(written[0]?.obj.workerLimits).toEqual({
      ...limits,
      healthcheckcpu: 0,
      transcodecpu: 0,
      transcodegpu: 1,
    })
    expect(Array.isArray(written[0]?.obj.schedule)).toBe(true)
    expect(written[0]?.obj.gpuSelect).toBe('-')
  })

  test('library names resolve to ids for the do-not-process list', async () => {
    const { client, nodeUpdates } = fakeClient({
      connected: connectedOtter,
      libraries: [{ _id: 'lib1', name: 'Movies' }],
    })
    const step = new TdarrNodesStep()

    await step.execute(
      contextWith([{ name: 'our-otter', librariesToNotProcess: ['Movies'] }], client),
    )

    expect(nodeUpdates[0]?.updates).toEqual({ librariesToNotProcess: { lib1: true } })
  })

  test('an unknown library name fails that node and leaves the rest alone', async () => {
    const { client, nodeUpdates } = fakeClient({
      connected: {
        ...connectedOtter,
        gpu1: { _id: 'gpu1', nodeName: 'gpu-node', workerLimits: limits, nodePaused: false },
      },
    })
    const step = new TdarrNodesStep()

    const result = await step.execute(
      contextWith(
        [
          { name: 'our-otter', librariesToNotProcess: ['Nope'] },
          { name: 'gpu-node', nodePaused: true },
        ],
        client,
      ),
    )

    expect(result.success).toBe(false)
    expect(result.errors[0]?.message).toMatch(/Nope/)
    expect(nodeUpdates).toEqual([{ nodeID: 'gpu1', updates: { nodePaused: true } }])
  })
})
