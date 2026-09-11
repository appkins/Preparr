import type { SabnzbdConfig } from '@/config/schema'
import {
  type ChangeRecord,
  ConfigurationStep,
  type StepContext,
  type StepResult,
  type Warning,
} from '@/core/step'
import { toError } from '@/utils/errors'
import { logger } from '@/utils/logger'

export class SabnzbdConfigStep extends ConfigurationStep {
  readonly name = 'sabnzbd-config'
  readonly description = 'Configure SABnzbd paths, categories and servers'
  readonly dependencies: string[] = ['sabnzbd-connectivity']
  readonly mode: 'init' | 'sidecar' | 'both' = 'sidecar'

  /**
   * Only the client's presence is required, deliberately not isReady().
   *
   * SABnzbd authenticates per request with an API key, so there is no session
   * for an init-mode step to establish and nothing for a readiness flag to
   * mean here. Gating on one would make this step skip on every cycle whenever
   * the flag is set elsewhere in the process -- which is exactly how the
   * qBittorrent equivalent ends up never running in sidecar mode.
   */
  validatePrerequisites(context: StepContext): boolean {
    return !!context.sabnzbdClient
  }

  readCurrentState(context: StepContext): Promise<{ configured: boolean }> {
    return Promise.resolve({ configured: !!context.sabnzbdClient })
  }

  protected getDesiredState(context: StepContext): { configured: boolean } {
    return { configured: !!context.config.app?.sabnzbd }
  }

  compareAndPlan(
    _current: { configured: boolean },
    desired: { configured: boolean },
    context: StepContext,
  ): ChangeRecord[] {
    if (!desired.configured || !context.sabnzbdClient) {
      return []
    }

    const sabnzbd = context.config.app?.sabnzbd

    return [
      {
        type: 'update',
        resource: 'sabnzbd-config',
        identifier: 'sabnzbd',
        details: {
          categories: sabnzbd?.categories?.length ?? 0,
          servers: sabnzbd?.servers?.length ?? 0,
          hasDownloadPaths: !!sabnzbd?.downloads,
        },
      },
    ]
  }

  async executeChanges(changes: ChangeRecord[], context: StepContext): Promise<StepResult> {
    const results: ChangeRecord[] = []
    const errors: Error[] = []
    const warnings: Warning[] = []

    for (const change of changes) {
      try {
        const config = context.config.app?.sabnzbd as SabnzbdConfig

        if (!config || !context.sabnzbdClient) {
          continue
        }

        await context.sabnzbdClient.applyConfiguration(config)
        results.push({ ...change, type: 'update' })

        logger.info('SABnzbd configuration applied successfully', {
          categories: config.categories?.length ?? 0,
          servers: config.servers?.length ?? 0,
        })
      } catch (error) {
        const stepError = toError(error)
        errors.push(stepError)
        logger.error('Failed to apply SABnzbd configuration', { error: stepError.message })
      }
    }

    return { success: errors.length === 0, changes: results, errors, warnings }
  }

  async verifySuccess(context: StepContext): Promise<boolean> {
    try {
      return (await context.sabnzbdClient?.testConnection()) || false
    } catch (error) {
      logger.debug('SABnzbd configuration verification failed', { error })
      return false
    }
  }
}
