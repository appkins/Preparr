import {
  type ChangeRecord,
  ServarrStep,
  type StepContext,
  type StepResult,
  type Warning,
} from '@/core/step'
import { type AdminUserState, adminUserAction } from '@/servarr/admin-user-state'
import { toError } from '@/utils/errors'
import { logger } from '@/utils/logger'

export class UserCreationStep extends ServarrStep {
  readonly name = 'user-creation'
  readonly description = 'Create initial admin user for Servarr'
  readonly dependencies: string[] = ['servarr-connectivity']
  readonly mode: 'init' | 'sidecar' | 'both' = 'sidecar'

  validatePrerequisites(context: StepContext): boolean {
    // Only run in sidecar mode when Servarr is ready
    return context.executionMode === 'sidecar' && this.client.isReady()
  }

  async readCurrentState(_context: StepContext): Promise<AdminUserState> {
    try {
      return await this.client.adminUserState()
    } catch (error) {
      // Unreadable state is not evidence that the user is fine, so the
      // reconciling call is planned and left to decide for itself.
      logger.debug('Failed to read admin user state', { error })
      return { exists: false, passwordCurrent: false, duplicates: 0 }
    }
  }

  protected getDesiredState(context: StepContext): { username: string } {
    return { username: context.config.servarr.adminUser }
  }

  compareAndPlan(
    current: AdminUserState,
    desired: { username: string },
    _context: StepContext,
  ): ChangeRecord[] {
    const action = adminUserAction(current)

    if (action === null) {
      return []
    }

    return [
      {
        type: action,
        resource: 'admin-user',
        identifier: desired.username,
        details: {
          username: desired.username,
          action: 'create-user',
        },
      },
    ]
  }

  async executeChanges(changes: ChangeRecord[], _context: StepContext): Promise<StepResult> {
    const results: ChangeRecord[] = []
    const errors: Error[] = []
    const warnings: Warning[] = []

    for (const change of changes) {
      try {
        if (change.details?.action === 'create-user') {
          const username = change.details.username as string

          // One call covers all of it: it creates the user, re-hashes a
          // changed password, and clears out any other user.
          await this.client.createInitialUser()

          results.push(change)

          // Says what was outstanding, not what the call did -- it reports
          // that itself, and claiming a creation that did not happen is how
          // this step read as working while planning the same change for ever.
          logger.info('Admin user reconciled', { username, outstanding: change.type })
        }
      } catch (error) {
        const stepError = toError(error)
        errors.push(stepError)
        logger.error('Failed to create initial user', {
          error: stepError.message,
          username: change.details?.username,
        })
      }
    }

    return {
      success: errors.length === 0,
      changes: results,
      errors,
      warnings,
    }
  }

  async verifySuccess(_context: StepContext): Promise<boolean> {
    try {
      // Test connection to verify user was created successfully
      return await this.client.testConnection()
    } catch (error) {
      logger.debug('User creation verification failed', { error })
      return false
    }
  }
}
