import { describe, expect, test } from 'bun:test'
import type { Config } from '@/config/schema'
import type { StepContext } from '@/core/step'
import type { SabnzbdManager } from '@/sabnzbd/client'
import { SabnzbdConnectivityStep } from './sabnzbd-connectivity'

function contextWith(client?: SabnzbdManager, executionMode: 'init' | 'sidecar' = 'sidecar') {
  return {
    config: { app: {} } as unknown as Config,
    servarrType: 'sabnzbd',
    executionMode,
    sabnzbdClient: client,
  } as unknown as StepContext
}

function fakeClient(reachable: boolean) {
  return {
    testConnection: () => Promise.resolve(reachable),
    isReady: () => reachable,
    initialize: () => Promise.resolve(),
  } as unknown as SabnzbdManager
}

describe('SabnzbdConnectivityStep', () => {
  test('skips when no sabnzbd client is configured', () => {
    expect(new SabnzbdConnectivityStep().validatePrerequisites(contextWith())).toBe(false)
  })

  test('runs in sidecar mode when a client is configured', () => {
    expect(new SabnzbdConnectivityStep().validatePrerequisites(contextWith(fakeClient(true)))).toBe(
      true,
    )
  })

  test('reports connected when the api answers', async () => {
    const step = new SabnzbdConnectivityStep()

    expect(await step.readCurrentState(contextWith(fakeClient(true)))).toEqual({ connected: true })
  })

  test('reports disconnected when the api does not answer', async () => {
    const step = new SabnzbdConnectivityStep()

    expect(await step.readCurrentState(contextWith(fakeClient(false)))).toEqual({
      connected: false,
    })
  })

  test('plans a connection attempt while disconnected', async () => {
    const step = new SabnzbdConnectivityStep()
    const context = contextWith(fakeClient(false))

    const changes = await step.compareAndPlan({ connected: false }, { connected: true }, context)

    expect(changes).toHaveLength(1)
  })

  test('plans nothing once connected', async () => {
    const step = new SabnzbdConnectivityStep()
    const context = contextWith(fakeClient(true))

    const changes = await step.compareAndPlan({ connected: true }, { connected: true }, context)

    expect(changes).toHaveLength(0)
  })

  test('fails the step when sabnzbd cannot be reached', async () => {
    const step = new SabnzbdConnectivityStep()

    const result = await step.execute(contextWith(fakeClient(false)))

    expect(result.success).toBe(false)
  })
})
