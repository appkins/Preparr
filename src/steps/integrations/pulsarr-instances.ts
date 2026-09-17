import type { PulsarrConfig } from '@/config/schema'
import {
  type ChangeRecord,
  ConfigurationStep,
  type StepContext,
  type StepResult,
  type Warning,
} from '@/core/step'
import type { PulsarrApp } from '@/pulsarr/client'
import { instanceMatches, type PulsarrInstanceRecord } from '@/pulsarr/instance-payload'
import { toError } from '@/utils/errors'
import { logger } from '@/utils/logger'

type Current = Record<PulsarrApp, PulsarrInstanceRecord[]>

const APPS: PulsarrApp[] = ['sonarr', 'radarr']

/**
 * Register the Sonarr and Radarr instances Pulsarr routes watchlist entries
 * into.
 *
 * These are the only part of Pulsarr's configuration that is not an
 * environment variable: they live in its database, which is why they are
 * reconciled here rather than set on the Deployment.
 *
 * The comparison is done against what Pulsarr actually holds rather than
 * planning a blanket update, so a cycle with nothing to do reports no changes.
 * A step that always plans one is what made the Servarr download clients and
 * custom formats rewrite themselves every thirty seconds.
 */
export class PulsarrInstancesStep extends ConfigurationStep {
  readonly name = 'pulsarr-instances'
  readonly description = 'Register Sonarr and Radarr instances in Pulsarr'
  readonly dependencies: string[] = ['pulsarr-connectivity']
  readonly mode: 'init' | 'sidecar' | 'both' = 'sidecar'

  validatePrerequisites(context: StepContext): boolean {
    return !!context.pulsarrClient && !!context.config.app?.pulsarr
  }

  async readCurrentState(context: StepContext): Promise<Current> {
    const client = context.pulsarrClient
    const current: Current = { sonarr: [], radarr: [] }

    if (!client) {
      return current
    }

    for (const app of APPS) {
      try {
        current[app] = await client.listInstances(app)
      } catch (error) {
        // Left empty rather than thrown: a create is then planned, and the
        // failure surfaces from the write with the reason attached.
        logger.debug('Could not list Pulsarr instances', { app, error })
      }
    }

    return current
  }

  protected getDesiredState(context: StepContext): PulsarrConfig | undefined {
    return context.config.app?.pulsarr
  }

  compareAndPlan(
    current: Current,
    desired: PulsarrConfig | undefined,
    _context: StepContext,
  ): ChangeRecord[] {
    if (!desired) {
      return []
    }

    const changes: ChangeRecord[] = []

    for (const app of APPS) {
      for (const want of desired[app]) {
        const have = current[app].find((i) => i.name === want.name)

        if (!have) {
          changes.push({ type: 'create', resource: `pulsarr-${app}`, identifier: want.name })
          continue
        }

        if (!instanceMatches(have as unknown as Record<string, unknown>, want)) {
          changes.push({ type: 'update', resource: `pulsarr-${app}`, identifier: want.name })
        }
      }
    }

    return changes
  }

  async executeChanges(changes: ChangeRecord[], context: StepContext): Promise<StepResult> {
    const errors: Error[] = []
    const warnings: Warning[] = []
    const results: ChangeRecord[] = []

    const desired = this.getDesiredState(context)
    const client = context.pulsarrClient

    if (changes.length === 0 || !desired || !client) {
      return { success: true, changes: results, errors, warnings }
    }

    for (const app of APPS) {
      // Only the instances that were planned; the rest already say what they
      // should and must not be rewritten.
      const planned = new Set(
        changes.filter((c) => c.resource === `pulsarr-${app}`).map((c) => c.identifier),
      )
      const wanted = desired[app].filter((i) => planned.has(i.name))

      if (wanted.length === 0) {
        continue
      }

      try {
        const { created, updated } = await client.syncInstances(app, wanted)

        for (const name of created) {
          results.push({ type: 'create', resource: `pulsarr-${app}`, identifier: name })
        }
        for (const name of updated) {
          results.push({ type: 'update', resource: `pulsarr-${app}`, identifier: name })
        }
      } catch (error) {
        errors.push(toError(error))
      }
    }

    return { success: errors.length === 0, changes: results, errors, warnings }
  }

  async verifySuccess(context: StepContext): Promise<boolean> {
    const desired = this.getDesiredState(context)
    if (!desired) {
      return true
    }

    const current = await this.readCurrentState(context)
    return this.compareAndPlan(current, desired, context).length === 0
  }
}
