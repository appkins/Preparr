import { describe, expect, test } from 'bun:test'
import type { Config } from '@/config/schema'
import type { StepContext } from '@/core/step'
import type { ProwlarrExtrasClient } from '@/prowlarr/client'
import { IndexerProxiesStep } from './indexer-proxies'

function fakeClient() {
  const seen = { labels: [] as string[], proxies: 0, indexerTags: [] as string[] }

  const client = {
    ensureTags: (labels: string[]) => {
      seen.labels = labels
      return Promise.resolve(Object.fromEntries(labels.map((l, i) => [l.toLowerCase(), i + 1])))
    },
    syncIndexerProxies: (proxies: unknown[]) => {
      seen.proxies = proxies.length
      return Promise.resolve({ created: ['FlareSolverr'], updated: [] })
    },
    syncIndexerTags: (map: Record<string, string[]>) => {
      seen.indexerTags = Object.keys(map)
      return Promise.resolve({ tagged: Object.keys(map), skipped: [] })
    },
  } as unknown as ProwlarrExtrasClient

  return { client, seen }
}

function contextWith(app: unknown, client?: ProwlarrExtrasClient, servarrType = 'prowlarr') {
  return {
    config: { app } as unknown as Config,
    servarrType,
    executionMode: 'sidecar',
    prowlarrExtrasClient: client,
  } as unknown as StepContext
}

const app = {
  tags: ['standalone'],
  indexerProxies: [
    {
      name: 'FlareSolverr',
      implementation: 'FlareSolverr',
      implementationName: 'FlareSolverr',
      configContract: 'FlareSolverrSettings',
      fields: [{ name: 'host', value: 'http://flaresolverr:8191/' }],
      tags: ['flaresolverr'],
    },
  ],
  indexerTags: { 'Nyaa.si': ['flaresolverr'] },
}

describe('IndexerProxiesStep', () => {
  test('skips when there is no prowlarr extras client', () => {
    expect(new IndexerProxiesStep().validatePrerequisites(contextWith(app))).toBe(false)
  })

  test('skips for a servarr app that is not prowlarr', () => {
    const { client } = fakeClient()

    expect(new IndexerProxiesStep().validatePrerequisites(contextWith(app, client, 'sonarr'))).toBe(
      false,
    )
  })

  test('runs for prowlarr', () => {
    const { client } = fakeClient()

    expect(new IndexerProxiesStep().validatePrerequisites(contextWith(app, client))).toBe(true)
  })

  test('creates every label named anywhere in the config', async () => {
    const { client, seen } = fakeClient()

    await new IndexerProxiesStep().execute(contextWith(app, client))

    // From app.tags, from a proxy's tags, and from indexerTags -- a tag is
    // wanted whichever of the three names it.
    expect(seen.labels.sort()).toEqual(['flaresolverr', 'standalone'])
  })

  test('applies proxies and indexer tags', async () => {
    const { client, seen } = fakeClient()

    const result = await new IndexerProxiesStep().execute(contextWith(app, client))

    expect(result.success).toBe(true)
    expect(seen.proxies).toBe(1)
    expect(seen.indexerTags).toEqual(['Nyaa.si'])
  })

  test('plans nothing when no tags, proxies or indexer tags are declared', async () => {
    const { client } = fakeClient()
    const context = contextWith({ tags: [], indexerProxies: [], indexerTags: {} }, client)
    const step = new IndexerProxiesStep()

    const changes = await step.compareAndPlan(
      await step.readCurrentState(context),
      step.getDesiredState(context),
      context,
    )

    expect(changes).toHaveLength(0)
  })

  test('reports failure when the client throws', async () => {
    const { client } = fakeClient()
    ;(client as unknown as { ensureTags: () => Promise<never> }).ensureTags = () =>
      Promise.reject(new Error('prowlarr unreachable'))

    const result = await new IndexerProxiesStep().execute(contextWith(app, client))

    expect(result.success).toBe(false)
    expect(result.errors[0]?.message).toContain('prowlarr unreachable')
  })
})
