import { describe, expect, test } from 'bun:test'
import { declaredMatches, mergeDeclared } from './match'

describe('declaredMatches', () => {
  test('a document with more keys than were declared still matches', () => {
    // Tdarr fills a library with fifty-odd keys; only the declared ones count.
    const current = { name: 'Movies', folder: '/data/movies', scannerThreadCount: 2 }

    expect(declaredMatches(current, { name: 'Movies' })).toBe(true)
  })

  test('a declared key that differs is a mismatch', () => {
    expect(declaredMatches({ folder: '/a' }, { folder: '/b' })).toBe(false)
  })

  test('a declared key the document lacks is a mismatch', () => {
    expect(declaredMatches({ name: 'x' }, { folderWatching: true })).toBe(false)
  })

  test('an undefined declared value is not a declaration', () => {
    expect(declaredMatches({ name: 'x' }, { name: 'x', cache: undefined })).toBe(true)
  })

  test('nested objects are compared on their declared keys too', () => {
    const current = { decisionMaker: { settingsFlows: true, settingsPlugin: false, other: 1 } }

    expect(declaredMatches(current, { decisionMaker: { settingsFlows: true } })).toBe(true)
    expect(declaredMatches(current, { decisionMaker: { settingsPlugin: true } })).toBe(false)
  })

  test('arrays compare element by element, each on its declared keys', () => {
    // The flow editor decorates every edge with animated and type when it
    // loads one; those are drawing instructions, not a change to the flow.
    const current = [
      { source: 'a', target: 'b', id: 'e1', animated: true, type: 'smoothstep' },
      { source: 'b', target: 'c', id: 'e2', animated: true, type: 'smoothstep' },
    ]
    const desired = [
      { source: 'a', target: 'b', id: 'e1' },
      { source: 'b', target: 'c', id: 'e2' },
    ]

    expect(declaredMatches(current, desired)).toBe(true)
  })

  test('arrays of different length differ', () => {
    expect(declaredMatches([{ a: 1 }], [{ a: 1 }, { a: 2 }])).toBe(false)
  })

  test('a number read back as a string is the same value', () => {
    expect(declaredMatches({ holdFor: 3600 }, { holdFor: '3600' })).toBe(true)
  })

  test('null and undefined on the document side both mean absent', () => {
    expect(declaredMatches({ output: null }, { output: '' })).toBe(false)
    expect(declaredMatches({ output: null }, { output: null })).toBe(true)
  })
})

describe('mergeDeclared', () => {
  test('replaces scalars and arrays, merges nested objects', () => {
    const current = {
      folder: '/old',
      decisionMaker: { settingsFlows: false, settingsPlugin: true, settingsVideo: false },
      flowPlugins: [{ id: 'old' }],
    }
    const merged = mergeDeclared(current, {
      folder: '/new',
      decisionMaker: { settingsFlows: true, settingsPlugin: false },
      flowPlugins: [{ id: 'new' }],
    })

    expect(merged).toEqual({
      folder: '/new',
      decisionMaker: { settingsFlows: true, settingsPlugin: false, settingsVideo: false },
      flowPlugins: [{ id: 'new' }],
    })
  })

  test('leaves undeclared keys alone and skips undefined declarations', () => {
    expect(mergeDeclared({ a: 1, b: 2 }, { b: undefined, c: 3 })).toEqual({ a: 1, b: 2, c: 3 })
  })

  test('does not mutate its inputs', () => {
    const current = { nested: { a: 1 } }
    const desired = { nested: { b: 2 } }
    mergeDeclared(current, desired)

    expect(current).toEqual({ nested: { a: 1 } })
    expect(desired).toEqual({ nested: { b: 2 } })
  })
})
