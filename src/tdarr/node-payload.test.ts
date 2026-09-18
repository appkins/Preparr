import { describe, expect, test } from 'bun:test'
import type { TdarrNode } from '@/config/schema'
import { desiredNode } from './node-payload'

const current = {
  _id: 'our-otter',
  workerLimits: { healthcheckcpu: 1, healthcheckgpu: 0, transcodecpu: 1, transcodegpu: 0 },
  nodePaused: false,
  nodeTags: '',
  librariesToNotProcess: {},
}

const libraryIds = new Map([
  ['Movies', 'lib1'],
  ['TV', 'lib2'],
])

describe('desiredNode', () => {
  test('carries only what was declared', () => {
    const desired = desiredNode({ name: 'our-otter', nodePaused: true }, current, libraryIds)

    expect(desired).toEqual({ nodePaused: true })
  })

  test('partial worker limits are completed from the node, since the server replaces the object', () => {
    // updateNode stores workerLimits wholesale; sending {transcodecpu: 2}
    // alone would leave the node with no health check limits at all.
    const desired = desiredNode(
      { name: 'our-otter', workerLimits: { transcodecpu: 2 } },
      current,
      libraryIds,
    )

    expect(desired.workerLimits).toEqual({
      healthcheckcpu: 1,
      healthcheckgpu: 0,
      transcodecpu: 2,
      transcodegpu: 0,
    })
  })

  test('worker limits on an unknown node fill the gaps with zero', () => {
    const desired = desiredNode(
      { name: 'new-node', workerLimits: { transcodegpu: 1 } },
      undefined,
      libraryIds,
    )

    expect(desired.workerLimits).toEqual({
      healthcheckcpu: 0,
      healthcheckgpu: 0,
      transcodecpu: 0,
      transcodegpu: 1,
    })
  })

  test('libraries not to process are named, and the list is the whole list', () => {
    // Tdarr keeps a map of library id to true. Declaring ["TV"] means TV is
    // excluded and everything else is not, so Movies is written as false
    // rather than left as whatever it was.
    const desired = desiredNode(
      { name: 'our-otter', librariesToNotProcess: ['TV'] },
      { ...current, librariesToNotProcess: { lib1: true } },
      libraryIds,
    )

    expect(desired.librariesToNotProcess).toEqual({ lib1: false, lib2: true })
  })

  test('an unknown library name is reported rather than silently dropped', () => {
    expect(() =>
      desiredNode({ name: 'our-otter', librariesToNotProcess: ['Nope'] }, current, libraryIds),
    ).toThrow(/Nope/)
  })

  test('the name is never sent: it is how the node is found, not a setting', () => {
    const node: TdarrNode = { name: 'our-otter', gpuSelect: 'nvenc' }
    expect('name' in desiredNode(node, current, libraryIds)).toBe(false)
  })
})
