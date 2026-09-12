import {
  type ChangeRecord,
  ConfigurationStep,
  type StepContext,
  type StepResult,
  type Warning,
} from '@/core/step'
import { logger } from '@/utils/logger'

/**
 * Confirm LazyLibrarian's API answers before anything tries to configure it.
 *
 * Reading a setting is the cheapest call that proves all three things the
 * later step needs: the instance is up, the API is switched on, and the key is
 * the right one. A version or status call would prove only the first.
 */
export class LazyLibrarianConnectivityStep extends ConfigurationStep {
  readonly name = 'lazylibrarian-connectivity'
  readonly description = 'Verify LazyLibrarian API connectivity'
  readonly dependencies: string[] = []
  readonly mode: 'init' | 'sidecar' | 'both' = 'sidecar'

  validatePrerequisites(context: StepContext): boolean {
    return !!context.lazyLibrarianClient
  }

  async readCurrentState(context: StepContext): Promise<{ reachable: boolean }> {
    const client = context.lazyLibrarianClient
    if (!client) {
      return { reachable: false }
    }

    try {
      await client.read('General', 'EBOOK_DIR')
      return { reachable: true }
    } catch (error) {
      logger.warn('LazyLibrarian is not reachable', { error })
      return { reachable: false }
    }
  }

  protected getDesiredState(_context: StepContext): { reachable: boolean } {
    return { reachable: true }
  }

  compareAndPlan(
    current: { reachable: boolean },
    _desired: { reachable: boolean },
    _context: StepContext,
  ): ChangeRecord[] {
    return current.reachable
      ? []
      : [{ type: 'no-change', resource: 'lazylibrarian', identifier: 'connectivity' }]
  }

  executeChanges(_changes: ChangeRecord[], _context: StepContext): Promise<StepResult> {
    const warnings: Warning[] = []
    return Promise.resolve({ success: true, changes: [], errors: [], warnings })
  }

  async verifySuccess(context: StepContext): Promise<boolean> {
    return (await this.readCurrentState(context)).reachable
  }
}
