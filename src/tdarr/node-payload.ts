import type { TdarrNode } from '@/config/schema'
import type { Plain } from './match'

/**
 * A node's server-side record.
 *
 * The server keeps one per node name and hands it to the node when it
 * registers, so a node's environment only ever seeds these values once. The
 * fields here are exactly the ones the server's updateNode is willing to
 * persist; anything else sent to it is applied to the live node and lost on
 * the next restart.
 */

export const WORKER_TYPES = [
  'healthcheckcpu',
  'healthcheckgpu',
  'transcodecpu',
  'transcodegpu',
] as const

export type WorkerType = (typeof WORKER_TYPES)[number]

export interface StoredNode {
  _id?: string
  workerLimits?: Partial<Record<WorkerType, number>> | undefined
  librariesToNotProcess?: Record<string, boolean> | undefined
  [key: string]: unknown
}

const zeroLimits = (): Record<WorkerType, number> => ({
  healthcheckcpu: 0,
  healthcheckgpu: 0,
  transcodecpu: 0,
  transcodegpu: 0,
})

/** The record the server creates for a node it has not seen before. */
export function nodeDefaults(): Plain {
  return {
    workerLimits: zeroLimits(),
    schedule: Array.from({ length: 24 }, (_, h) => ({
      _id: `${String(h).padStart(2, '0')}-${String((h + 1) % 24).padStart(2, '0')}`,
      ...zeroLimits(),
    })),
    gpuSelect: '-',
    nodeTags: '',
    allowGpuDoCpu: false,
    maxGpuWorkers: 100,
    nodePaused: false,
    deleteCacheAnyStageError: true,
    processPriority: 'normal',
    thoroughHealthCheckCpuExtraInputArgs: '',
    thoroughHealthCheckGpuExtraInputArgs: '',
    thoroughHealthCheckCpuExtraArgs: '',
    thoroughHealthCheckGpuExtraArgs: '',
    librariesToNotProcess: {},
    scheduleEnabled: false,
    priority: 0,
  }
}

/**
 * The settings to apply to a node, as the server stores them.
 *
 * Worker limits are completed from the node's current ones because the
 * server replaces the object wholesale: declaring only a transcode count
 * must not leave the node with no health check limit at all.
 *
 * librariesToNotProcess is a map of library id to true. A declared list is
 * the whole list, so a library the node currently refuses that is not in it
 * is written as false; libraries it already processes are not mentioned, as
 * an absent key and a false one mean the same thing to Tdarr.
 */
export function desiredNode(
  node: TdarrNode,
  current: StoredNode | undefined,
  libraryIds: Map<string, string>,
): Plain {
  const { name, workerLimits, librariesToNotProcess, ...rest } = node
  const desired: Plain = {}

  for (const [key, value] of Object.entries(rest)) {
    if (value !== undefined) {
      desired[key] = value
    }
  }

  if (workerLimits) {
    const base = current?.workerLimits ?? {}
    desired.workerLimits = Object.fromEntries(
      WORKER_TYPES.map((type) => [type, workerLimits[type] ?? base[type] ?? 0]),
    )
  }

  if (librariesToNotProcess) {
    const map: Record<string, boolean> = {}
    for (const [id, refused] of Object.entries(current?.librariesToNotProcess ?? {})) {
      if (refused === true) {
        map[id] = false
      }
    }
    for (const libraryName of librariesToNotProcess) {
      const id = libraryIds.get(libraryName)
      if (!id) {
        throw new Error(`Tdarr library "${libraryName}" named by node ${name} does not exist`)
      }
      map[id] = true
    }
    desired.librariesToNotProcess = map
  }

  return desired
}
