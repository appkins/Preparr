import {
  type ChangeRecord,
  ConfigurationStep,
  type StepContext,
  type StepResult,
  type Warning,
} from '@/core/step'
import type { TdarrDocument } from '@/tdarr/client'
import { changedKeys, type Plain, updateBody } from '@/tdarr/match'
import { toError } from '@/utils/errors'
import { logger } from '@/utils/logger'

const COLLECTION = 'SettingsGlobalJSONDB'
const DOC_ID = 'globalsettings'

/**
 * Reconcile Tdarr's global settings.
 *
 * One document, by Tdarr's own key names, of which only the declared keys are
 * compared and written. The document holds UI state and version bookkeeping
 * alongside the settings, none of which a deployment should be pinning, and
 * a nested object such as dropdownShow is merged rather than replaced.
 */
export class TdarrSettingsStep extends ConfigurationStep {
  readonly name = 'tdarr-settings'
  readonly description = 'Reconcile Tdarr global settings'
  readonly dependencies: string[] = ['tdarr-connectivity']
  readonly mode: 'init' | 'sidecar' | 'both' = 'sidecar'

  validatePrerequisites(context: StepContext): boolean {
    return !!context.tdarrClient && Object.keys(this.getDesiredState(context)).length > 0
  }

  async readCurrentState(context: StepContext): Promise<TdarrDocument | undefined> {
    const client = context.tdarrClient
    if (!client) {
      return undefined
    }

    try {
      return await client.getById(COLLECTION, DOC_ID)
    } catch (error) {
      logger.debug('Could not read Tdarr global settings', { error })
      return undefined
    }
  }

  protected getDesiredState(context: StepContext): Plain {
    return context.config.app?.tdarr?.settings ?? {}
  }

  compareAndPlan(
    current: TdarrDocument | undefined,
    desired: Plain,
    _context: StepContext,
  ): ChangeRecord[] {
    const keys = changedKeys(current, desired)
    return keys.length === 0
      ? []
      : [{ type: 'update', resource: 'tdarr-settings', identifier: DOC_ID, details: { keys } }]
  }

  async executeChanges(changes: ChangeRecord[], context: StepContext): Promise<StepResult> {
    const errors: Error[] = []
    const warnings: Warning[] = []
    const results: ChangeRecord[] = []
    const client = context.tdarrClient

    if (changes.length === 0 || !client) {
      return { success: true, changes: results, errors, warnings }
    }

    try {
      const current = await this.readCurrentState(context)
      const body = updateBody(current, this.getDesiredState(context))

      logger.info('Updating Tdarr global settings', { keys: Object.keys(body) })
      await client.update(COLLECTION, DOC_ID, body)
      results.push({
        type: 'update',
        resource: 'tdarr-settings',
        identifier: DOC_ID,
        details: { keys: Object.keys(body) },
      })
    } catch (error) {
      errors.push(toError(error))
    }

    return { success: errors.length === 0, changes: results, errors, warnings }
  }

  async verifySuccess(context: StepContext): Promise<boolean> {
    const current = await this.readCurrentState(context)
    return this.compareAndPlan(current, this.getDesiredState(context), context).length === 0
  }
}
