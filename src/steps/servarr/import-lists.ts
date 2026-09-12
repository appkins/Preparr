import type { ImportList } from '@/config/schema'
import {
  type ChangeRecord,
  ServarrStep,
  type StepContext,
  type StepResult,
  Warning,
} from '@/core/step'
import { importListMatches, withInstanceOwnedFields } from '@/servarr/import-list-fields'
import { toError } from '@/utils/errors'
import { logger } from '@/utils/logger'

type CurrentList = ImportList & { id: number }

export class ImportListsStep extends ServarrStep {
  readonly name = 'import-lists'
  readonly description = 'Configure Servarr import lists'
  // Quality profiles first: a list refers to one by id, and referring to one
  // that does not exist yet is rejected.
  readonly dependencies: string[] = ['servarr-connectivity', 'quality-profiles']
  readonly mode: 'init' | 'sidecar' | 'both' = 'sidecar'

  validatePrerequisites(context: StepContext): boolean {
    if (context.servarrType === 'prowlarr') return false
    return this.client.isReady()
  }

  async readCurrentState(_context: StepContext): Promise<CurrentList[]> {
    try {
      return await this.client.getImportLists()
    } catch (error) {
      logger.warn('Failed to read current import lists', { error })
      return []
    }
  }

  protected getDesiredState(context: StepContext): ImportList[] {
    return context.config.app?.importLists ?? []
  }

  compareAndPlan(
    current: CurrentList[],
    desired: ImportList[],
    _context: StepContext,
  ): ChangeRecord[] {
    const changes: ChangeRecord[] = []

    for (const list of desired) {
      const existing = current.find((c) => c.name === list.name)

      if (!existing) {
        changes.push({
          type: 'create',
          resource: 'import-list',
          identifier: list.name,
          details: { implementation: list.implementation },
        })
        continue
      }

      if (!importListMatches(existing, list)) {
        changes.push({
          type: 'update',
          resource: 'import-list',
          identifier: list.name,
          details: { id: existing.id },
        })
      }
    }

    // Lists this deployment does not declare are left alone: one added by hand
    // is a deliberate act, and removing it is not what declaring another means.
    return changes
  }

  async executeChanges(changes: ChangeRecord[], context: StepContext): Promise<StepResult> {
    const results: ChangeRecord[] = []
    const errors: Error[] = []
    const warnings: Warning[] = []

    if (changes.length === 0) {
      return { success: true, changes: results, errors, warnings }
    }

    const desired = this.getDesiredState(context)
    const current = await this.readCurrentState(context)

    for (const change of changes) {
      try {
        const list = desired.find((l) => l.name === change.identifier)
        if (!list) {
          errors.push(new Error(`Import list not found in desired state: ${change.identifier}`))
          continue
        }

        const existing = current.find((c) => c.name === list.name)

        // Whatever the instance holds and the configuration does not set --
        // in practice the OAuth tokens, which no configuration can produce.
        const fields = withInstanceOwnedFields(existing?.fields ?? [], list.fields)
        const payload = { ...list, fields }

        if (change.type === 'create') {
          await this.client.addImportList(payload as Record<string, unknown>)
          logger.info('Import list created', { name: list.name })

          if (!fields.some((f) => f.name?.toLowerCase() === 'accesstoken')) {
            warnings.push(
              new Warning(
                `Import list "${list.name}" has no access token: it will not import anything until it is authenticated once in the application's own interface`,
              ),
            )
          }
        } else if (existing) {
          await this.client.updateImportList(existing.id, payload as Record<string, unknown>)
          logger.info('Import list updated', { name: list.name, id: existing.id })
        }

        results.push(change)
      } catch (error) {
        const stepError = toError(error)
        errors.push(stepError)
        logger.error('Failed to manage import list', {
          error: stepError.message,
          name: change.identifier,
        })
      }
    }

    return { success: errors.length === 0, changes: results, errors, warnings }
  }

  async verifySuccess(context: StepContext): Promise<boolean> {
    try {
      const names = new Set((await this.readCurrentState(context)).map((l) => l.name))
      return this.getDesiredState(context).every((l) => names.has(l.name))
    } catch (error) {
      logger.debug('Import list verification failed', { error })
      return false
    }
  }
}
