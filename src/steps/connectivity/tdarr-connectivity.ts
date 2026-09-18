import {
  type ChangeRecord,
  ConfigurationStep,
  type StepContext,
  type StepResult,
  type Warning,
} from '@/core/step'
import { logger } from '@/utils/logger'

/**
 * Confirm Tdarr's API answers before anything tries to configure it.
 *
 * Reading a collection is the cheapest call that proves all three things the
 * later steps need: the server is up, the database is open, and the key (if
 * auth is on) is accepted. The status endpoint is public and would prove only
 * the first.
 */
export class TdarrConnectivityStep extends ConfigurationStep {
  readonly name = 'tdarr-connectivity'
  readonly description = 'Verify Tdarr API connectivity'
  readonly dependencies: string[] = []
  readonly mode: 'init' | 'sidecar' | 'both' = 'sidecar'

  validatePrerequisites(context: StepContext): boolean {
    return !!context.tdarrClient
  }

  async readCurrentState(context: StepContext): Promise<{ reachable: boolean }> {
    const client = context.tdarrClient
    if (!client) {
      return { reachable: false }
    }

    const reachable = await client.ping()
    if (!reachable) {
      logger.warn('Tdarr is not reachable')
    }
    return { reachable }
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
      : [{ type: 'no-change', resource: 'tdarr', identifier: 'connectivity' }]
  }

  executeChanges(_changes: ChangeRecord[], _context: StepContext): Promise<StepResult> {
    const warnings: Warning[] = []
    return Promise.resolve({ success: true, changes: [], errors: [], warnings })
  }

  async verifySuccess(context: StepContext): Promise<boolean> {
    return (await this.readCurrentState(context)).reachable
  }
}
