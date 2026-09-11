import { describe, expect, test } from 'bun:test'
import { AppConfigSchema } from './schema'

describe('app.tags', () => {
  test('defaults to none', () => {
    expect(AppConfigSchema.parse({}).tags).toEqual([])
  })

  test('takes labels rather than ids', () => {
    // Prowlarr assigns tag ids itself -- POSTing a chosen id fails with
    // "Can't insert model with existing ID" -- so a tag can only be named.
    expect(AppConfigSchema.parse({ tags: ['flaresolverr', 'private'] }).tags).toEqual([
      'flaresolverr',
      'private',
    ])
  })
})

describe('app.indexerProxies', () => {
  test('defaults to none', () => {
    expect(AppConfigSchema.parse({}).indexerProxies).toEqual([])
  })

  test('carries an implementation, fields and tag labels', () => {
    const parsed = AppConfigSchema.parse({
      indexerProxies: [
        {
          name: 'FlareSolverr',
          implementation: 'FlareSolverr',
          configContract: 'FlareSolverrSettings',
          fields: [{ name: 'host', value: 'http://flaresolverr:8191/' }],
          tags: ['flaresolverr'],
        },
      ],
    })

    expect(parsed.indexerProxies[0]).toMatchObject({
      name: 'FlareSolverr',
      implementation: 'FlareSolverr',
      implementationName: 'FlareSolverr',
      configContract: 'FlareSolverrSettings',
      tags: ['flaresolverr'],
    })
  })

  test('defaults implementationName to implementation', () => {
    const parsed = AppConfigSchema.parse({
      indexerProxies: [
        { name: 'p', implementation: 'Http', configContract: 'HttpSettings', fields: [] },
      ],
    })

    expect(parsed.indexerProxies[0]?.implementationName).toBe('Http')
    expect(parsed.indexerProxies[0]?.tags).toEqual([])
  })

  test('requires an implementation', () => {
    expect(() =>
      AppConfigSchema.parse({ indexerProxies: [{ name: 'p', configContract: 'x', fields: [] }] }),
    ).toThrow()
  })
})

describe('app.indexerTags', () => {
  test('defaults to none', () => {
    expect(AppConfigSchema.parse({}).indexerTags).toEqual({})
  })

  test('maps an indexer name to the labels it should carry', () => {
    const parsed = AppConfigSchema.parse({
      indexerTags: { 'Nyaa.si': ['flaresolverr'], NZBgeek: ['usenet', 'private'] },
    })

    expect(parsed.indexerTags['Nyaa.si']).toEqual(['flaresolverr'])
    expect(parsed.indexerTags.NZBgeek).toEqual(['usenet', 'private'])
  })
})
