import {
  type ChangeRecord,
  ConfigurationStep,
  type StepContext,
  type StepResult,
  type Warning,
} from '@/core/step'
import { toError } from '@/utils/errors'
import { logger } from '@/utils/logger'

export class SabnzbdConnectivityStep extends ConfigurationStep {
  readonly name = 'sabnzbd-connectivity'
  readonly description = 'Validate SABnzbd connectivity and API key'
  readonly dependencies: string[] = []
  readonly mode: 'init' | 'sidecar' | 'both' = 'sidecar'

  validatePrerequisites(context: StepContext): boolean {
    return !!context.sabnzbdClient && context.executionMode === 'sidecar'
  }

  /**
   * One flag rather than the connected/authenticated pair the qBittorrent step
   * carries: SABnzbd authenticates per request, so a reachable instance that
   * accepts the API key is the only state there is to distinguish.
   */
  async readCurrentState(context: StepContext): Promise<{ connected: boolean }> {
    try {
      if (!context.sabnzbdClient) {
        return { connected: false }
      }

      return { connected: await context.sabnzbdClient.testConnection() }
    } catch (error) {
      logger.debug('SABnzbd connection test failed', { error })
      return { connected: false }
    }
  }

  protected getDesiredState(context: StepContext): { connected: boolean } {
    return { connected: !!context.sabnzbdClient }
  }

  compareAndPlan(
    current: { connected: boolean },
    desired: { connected: boolean },
    _context: StepContext,
  ): ChangeRecord[] {
    if (!desired.connected || current.connected) {
      return []
    }

    return [
      {
        type: 'update',
        resource: 'sabnzbd-connection',
        identifier: 'sabnzbd',
        details: { action: 'connect' },
      },
    ]
  }

  async executeChanges(changes: ChangeRecord[], context: StepContext): Promise<StepResult> {
    const results: ChangeRecord[] = []
    const errors: Error[] = []
    const warnings: Warning[] = []

    for (const change of changes) {
      try {
        if (!context.sabnzbdClient) {
          continue
        }

        await context.sabnzbdClient.initialize()

        if (!(await context.sabnzbdClient.testConnection())) {
          throw new Error('SABnzbd is not reachable or rejected the API key')
        }

        results.push({ ...change, type: 'update' })
        logger.info('SABnzbd connectivity verified')
      } catch (error) {
        const stepError = toError(error)
        errors.push(stepError)
        logger.error('SABnzbd connectivity check failed', { error: stepError.message })
      }
    }

    return { success: errors.length === 0, changes: results, errors, warnings }
  }

  async verifySuccess(context: StepContext): Promise<boolean> {
    try {
      return (await context.sabnzbdClient?.testConnection()) || false
    } catch {
      return false
    }
  }
}
