import { describe, expect, test } from 'bun:test'
import type { Config, SabnzbdConfig } from '@/config/schema'
import type { StepContext } from '@/core/step'
import type { SabnzbdManager } from '@/sabnzbd/client'
import { SabnzbdConfigStep } from './sabnzbd-config'

function fakeClient(overrides: Partial<SabnzbdManager> = {}) {
  const applied: SabnzbdConfig[] = []
  const client = {
    isReady: () => false,
    testConnection: () => Promise.resolve(true),
    applyConfiguration: (config: SabnzbdConfig) => {
      applied.push(config)
      return Promise.resolve()
    },
    ...overrides,
  } as unknown as SabnzbdManager

  return { client, applied }
}

function contextWith(sabnzbd: unknown, client?: SabnzbdManager): StepContext {
  return {
    config: { app: { sabnzbd } } as unknown as Config,
    servarrType: 'sabnzbd',
    executionMode: 'sidecar',
    sabnzbdClient: client,
  } as unknown as StepContext
}

const sample = {
  downloads: { completePath: '/data/usenet/complete', incompletePath: '/data/usenet/incomplete' },
  categories: [{ name: 'tv', dir: 'tv', priority: -100, script: 'Default' }],
  servers: [],
} as SabnzbdConfig

describe('SabnzbdConfigStep', () => {
  test('skips when no sabnzbd client is present', () => {
    const step = new SabnzbdConfigStep()

    expect(step.validatePrerequisites(contextWith(sample))).toBe(false)
  })

  test('runs on a client that has not been initialized', () => {
    // Deliberately not gated on isReady(): SABnzbd has no login handshake, so
    // there is no session for a separate init step to establish. Gating on it
    // is what leaves the qBittorrent equivalent skipping every cycle.
    const { client } = fakeClient({ isReady: () => false })
    const step = new SabnzbdConfigStep()

    expect(step.validatePrerequisites(contextWith(sample, client))).toBe(true)
  })

  test('plans a change when configuration is present', async () => {
    const { client } = fakeClient()
    const step = new SabnzbdConfigStep()
    const context = contextWith(sample, client)

    const changes = await step.compareAndPlan(
      await step.readCurrentState(context),
      step.getDesiredState(context),
      context,
    )

    expect(changes).toHaveLength(1)
    expect(changes[0]?.resource).toBe('sabnzbd-config')
  })

  test('plans nothing when there is no sabnzbd configuration', async () => {
    const { client } = fakeClient()
    const step = new SabnzbdConfigStep()
    const context = contextWith(undefined, client)

    const changes = await step.compareAndPlan(
      await step.readCurrentState(context),
      step.getDesiredState(context),
      context,
    )

    expect(changes).toHaveLength(0)
  })

  test('applies the configuration through the client', async () => {
    const { client, applied } = fakeClient()
    const step = new SabnzbdConfigStep()
    const context = contextWith(sample, client)

    const result = await step.execute(context)

    expect(result.success).toBe(true)
    expect(applied).toHaveLength(1)
    expect(applied[0]?.categories?.[0]?.name).toBe('tv')
  })

  test('reports failure when the client throws', async () => {
    const { client } = fakeClient({
      applyConfiguration: () => Promise.reject(new Error('sabnzbd unreachable')),
    })
    const step = new SabnzbdConfigStep()

    const result = await step.execute(contextWith(sample, client))

    expect(result.success).toBe(false)
    expect(result.errors[0]?.message).toContain('sabnzbd unreachable')
  })
})
