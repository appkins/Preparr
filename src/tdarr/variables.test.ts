import { describe, expect, test } from 'bun:test'
import { planVariables } from './variables'

const stored = [
  { _id: 'v1', key: 'radarrApiKey', value: 'abc', type: 'global', date: 1 },
  { _id: 'v2', key: 'quality', value: '20', type: 'library:lib1', date: 2 },
  { _id: 'v3', key: 'radarrApiKey', value: 'other', type: 'library:lib1', date: 3 },
]

describe('planVariables', () => {
  test('plans nothing when every variable already holds its value', () => {
    expect(planVariables(stored, { radarrApiKey: 'abc' }, 'global')).toEqual({
      create: [],
      update: [],
    })
  })

  test('creates a variable the scope lacks and updates one that differs', () => {
    const plan = planVariables(stored, { radarrApiKey: 'new', sonarrApiKey: 'x' }, 'global')

    expect(plan.create).toEqual([{ key: 'sonarrApiKey', value: 'x', type: 'global' }])
    expect(plan.update).toEqual([{ _id: 'v1', key: 'radarrApiKey', value: 'new', type: 'global' }])
  })

  test('scopes are separate: a library variable never satisfies a global one', () => {
    const plan = planVariables(stored, { quality: '20' }, 'global')

    expect(plan.create).toEqual([{ key: 'quality', value: '20', type: 'global' }])
  })

  test('values are stored as text, which is how the flow editor stores them', () => {
    // A number or boolean in configuration is still substituted as text into
    // a plugin input; comparing as text means 20 and "20" are one value.
    expect(planVariables(stored, { quality: 20 }, 'library:lib1')).toEqual({
      create: [],
      update: [],
    })
    expect(planVariables([], { enabled: true }, 'global').create).toEqual([
      { key: 'enabled', value: 'true', type: 'global' },
    ])
  })

  test('a variable Tdarr holds that is not declared is left alone', () => {
    const plan = planVariables(stored, {}, 'library:lib1')
    expect(plan).toEqual({ create: [], update: [] })
  })
})
