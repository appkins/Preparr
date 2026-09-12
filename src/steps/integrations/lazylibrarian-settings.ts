import type { LazyLibrarianConfig } from '@/config/schema'
import {
  type ChangeRecord,
  ConfigurationStep,
  type StepContext,
  type StepResult,
  type Warning,
} from '@/core/step'
import { settingsFor } from '@/lazylibrarian/settings'
import { toError } from '@/utils/errors'
import { logger } from '@/utils/logger'

/**
 * Reconcile LazyLibrarian's settings on the running instance, over its API.
 *
 * The counterpart to writing the file: the file reaches an application that
 * has not started, and this reaches one that has. writeCFG saves to the same
 * file as well, so the two do not drift apart.
 */
export class LazyLibrarianSettingsStep extends ConfigurationStep {
  readonly name = 'lazylibrarian-settings'
  readonly description = 'Reconcile LazyLibrarian settings over its API'
  readonly dependencies: string[] = ['lazylibrarian-connectivity']
  readonly mode: 'init' | 'sidecar' | 'both' = 'sidecar'

  validatePrerequisites(context: StepContext): boolean {
    return !!context.lazyLibrarianClient && !!context.config.app?.lazylibrarian
  }

  readCurrentState(_context: StepContext): Promise<{ reachable: boolean }> {
    return Promise.resolve({ reachable: true })
  }

  protected getDesiredState(context: StepContext): LazyLibrarianConfig | undefined {
    return context.config.app?.lazylibrarian
  }

  compareAndPlan(
    _current: { reachable: boolean },
    desired: LazyLibrarianConfig | undefined,
    _context: StepContext,
  ): ChangeRecord[] {
    // What differs is only knowable by asking the instance, one setting at a
    // time, so the comparison happens during execution and this plans the
    // attempt. executeChanges reports the settings it actually wrote.
    return desired
      ? [{ type: 'update', resource: 'lazylibrarian-settings', identifier: 'settings' }]
      : []
  }

  async executeChanges(changes: ChangeRecord[], context: StepContext): Promise<StepResult> {
    const errors: Error[] = []
    const warnings: Warning[] = []
    const results: ChangeRecord[] = []

    const desired = this.getDesiredState(context)
    const client = context.lazyLibrarianClient

    if (changes.length === 0 || !desired || !client) {
      return { success: true, changes: results, errors, warnings }
    }

    try {
      // The API key and the switch that enables the API are deliberately not
      // sent here: they are what this connection is already using, and a
      // rejected write of either would lock the sidecar out of the instance.
      const { API: _api, ...settings } = settingsFor(desired)

      const changed = await client.apply(settings)

      for (const setting of changed) {
        results.push({ type: 'update', resource: 'lazylibrarian-setting', identifier: setting })
      }

      if (changed.length > 0) {
        logger.info('LazyLibrarian settings updated', { count: changed.length })
      }
    } catch (error) {
      const stepError = toError(error)
      errors.push(stepError)
      logger.error('Failed to reconcile LazyLibrarian settings', { error: stepError.message })
    }

    return { success: errors.length === 0, changes: results, errors, warnings }
  }

  verifySuccess(_context: StepContext): Promise<boolean> {
    return Promise.resolve(true)
  }
}
