import { describe, expect, test } from 'bun:test'
import type { TdarrFlow } from '@/config/schema'
import { desiredFlow, findFlow, generateId } from './flow-payload'

const hevc: TdarrFlow = {
  _id: 'hevc10Bit',
  name: 'HEVC 10-bit',
  priority: 1,
  flowPlugins: [{ id: 'input', pluginName: 'inputFile' }],
  flowEdges: [{ id: 'e1', source: 'input', target: 'x' }],
}

describe('findFlow', () => {
  const stored = [
    { _id: 'hevc10Bit', name: 'HEVC 10-bit' },
    { _id: 'abc', name: 'Other' },
  ]

  test('matches on _id when the flow declares one', () => {
    expect(findFlow(stored, hevc)?._id).toBe('hevc10Bit')
  })

  test('falls back to the name when it does not', () => {
    const { _id: _ignored, ...unnamed } = hevc
    expect(findFlow(stored, { ...unnamed, name: 'Other' })?._id).toBe('abc')
  })

  test('an _id that is absent is not matched by name instead', () => {
    // A declared id is an instruction; matching the name would silently adopt
    // some other flow and then rewrite it.
    expect(findFlow(stored, { ...hevc, _id: 'missing' })).toBeUndefined()
  })

  test('libraries name a flow by either name or id', () => {
    expect(findFlow(stored, 'Other')?._id).toBe('abc')
    expect(findFlow(stored, 'abc')?._id).toBe('abc')
    expect(findFlow(stored, 'nope')).toBeUndefined()
  })
})

describe('desiredFlow', () => {
  test('is the flow without its id, which is the document name not a field to compare', () => {
    expect(desiredFlow(hevc)).toEqual({
      name: 'HEVC 10-bit',
      priority: 1,
      flowPlugins: [{ id: 'input', pluginName: 'inputFile' }],
      flowEdges: [{ id: 'e1', source: 'input', target: 'x' }],
    })
  })

  test('keeps whatever else an export carried', () => {
    const desired = desiredFlow({ ...hevc, isUiLocked: false, description: 'x' } as TdarrFlow)
    expect(desired.isUiLocked).toBe(false)
    expect(desired.description).toBe('x')
  })
})

describe('generateId', () => {
  test('makes ids of the shape Tdarr makes', () => {
    const id = generateId()
    expect(id).toMatch(/^[A-Za-z0-9_-]{9}$/)
    expect(generateId()).not.toBe(id)
  })
})
