import {
  type ChangeRecord,
  ConfigurationStep,
  type StepContext,
  type StepResult,
  type Warning,
} from '@/core/step'
import { logger } from '@/utils/logger'

/**
 * Confirm Pulsarr's API answers before anything tries to configure it.
 *
 * Listing the Sonarr instances is the cheapest call that proves all three
 * things the later step needs: the instance is up, the API is reachable, and
 * the key is accepted. An unauthenticated health endpoint would prove only the
 * first.
 */
export class PulsarrConnectivityStep extends ConfigurationStep {
  readonly name = 'pulsarr-connectivity'
  readonly description = 'Verify Pulsarr API connectivity'
  readonly dependencies: string[] = []
  readonly mode: 'init' | 'sidecar' | 'both' = 'sidecar'

  validatePrerequisites(context: StepContext): boolean {
    return !!context.pulsarrClient
  }

  async readCurrentState(context: StepContext): Promise<{ reachable: boolean }> {
    const client = context.pulsarrClient
    if (!client) {
      return { reachable: false }
    }

    const reachable = await client.ping()
    if (!reachable) {
      logger.warn('Pulsarr is not reachable')
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
      : [{ type: 'no-change', resource: 'pulsarr', identifier: 'connectivity' }]
  }

  executeChanges(_changes: ChangeRecord[], _context: StepContext): Promise<StepResult> {
    const warnings: Warning[] = []
    return Promise.resolve({ success: true, changes: [], errors: [], warnings })
  }

  async verifySuccess(context: StepContext): Promise<boolean> {
    return (await this.readCurrentState(context)).reachable
  }
}
