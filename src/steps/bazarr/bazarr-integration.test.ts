import { describe, expect, test } from 'bun:test'
import { BazarrManager } from '@/bazarr/client'
import { BazarrIntegrationStep } from './bazarr-integration'

function stepWithClient(): BazarrIntegrationStep {
  const step = new BazarrIntegrationStep()
  // client is assigned by execute(); compareAndPlan only needs parseServiceUrl.
  // biome-ignore lint/suspicious/noExplicitAny: reaching past a protected field
  ;(step as any).client = new BazarrManager({ url: 'http://bazarr:6767', apiKey: 'k' })
  return step
}

const service = (basePath: string) => ({
  enabled: true,
  host: 'sonarr.media.svc.cluster.local',
  port: '8989',
  basePath,
  ssl: false,
  apiKey: 'a'.repeat(32),
})

describe('BazarrIntegrationStep.compareAndPlan', () => {
  test('an empty base path is the same root as "/"', () => {
    // parseServiceUrl reports "/" for a URL with no path, while Bazarr stores
    // and returns "". Comparing them literally made the step plan an update
    // every cycle: it wrote "/", Bazarr normalised it back to "", and the next
    // pass saw the same difference. Bazarr re-establishes its Sonarr and Radarr
    // SignalR feeds whenever settings are saved, so this reconnected both on
    // every reconcile.
    const step = stepWithClient()

    const changes = step.compareAndPlan(
      { sonarr: service(''), radarr: service('') },
      {
        sonarr: { url: 'http://sonarr.media.svc.cluster.local:8989', apiKey: 'a'.repeat(32) },
        radarr: { url: 'http://sonarr.media.svc.cluster.local:8989', apiKey: 'a'.repeat(32) },
      },
    )

    expect(changes).toEqual([])
  })

  test('a real base path difference is still a change', () => {
    const step = stepWithClient()

    const changes = step.compareAndPlan(
      { sonarr: service('/sonarr'), radarr: service('') },
      {
        sonarr: { url: 'http://sonarr.media.svc.cluster.local:8989', apiKey: 'a'.repeat(32) },
        radarr: { url: 'http://sonarr.media.svc.cluster.local:8989', apiKey: 'a'.repeat(32) },
      },
    )

    expect(changes.map((c) => c.identifier)).toEqual(['sonarr'])
  })
})
