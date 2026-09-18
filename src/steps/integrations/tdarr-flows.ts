import type { TdarrFlow } from '@/config/schema'
import {
  type ChangeRecord,
  ConfigurationStep,
  type StepContext,
  type StepResult,
  type Warning,
} from '@/core/step'
import type { TdarrDocument } from '@/tdarr/client'
import { desiredFlow, findFlow, generateId } from '@/tdarr/flow-payload'
import { declaredMatches, updateBody } from '@/tdarr/match'
import { toError } from '@/utils/errors'
import { logger } from '@/utils/logger'

const COLLECTION = 'FlowsJSONDB'

type StoredFlow = TdarrDocument & { name: string }

const identity = (flow: TdarrFlow): string => flow._id ?? flow.name

/**
 * Reconcile flows.
 *
 * A flow is the document the editor exports, inserted as it is. The editor
 * decorates edges and plugins with drawing state when it loads one and never
 * saves anything a plugin needs beyond its name, version and inputs, so
 * comparing the declared keys alone is comparing the whole flow.
 *
 * A flow Tdarr has that is not declared is left alone; this configures the
 * flows it is given and does not claim the whole list.
 */
export class TdarrFlowsStep extends ConfigurationStep {
  readonly name = 'tdarr-flows'
  readonly description = 'Reconcile Tdarr flows'
  readonly dependencies: string[] = ['tdarr-connectivity']
  readonly mode: 'init' | 'sidecar' | 'both' = 'sidecar'

  validatePrerequisites(context: StepContext): boolean {
    return !!context.tdarrClient && this.getDesiredState(context).length > 0
  }

  async readCurrentState(context: StepContext): Promise<StoredFlow[]> {
    const client = context.tdarrClient
    if (!client) {
      return []
    }

    try {
      return await client.getAll<StoredFlow>(COLLECTION)
    } catch (error) {
      logger.debug('Could not list Tdarr flows', { error })
      return []
    }
  }

  protected getDesiredState(context: StepContext): TdarrFlow[] {
    return context.config.app?.tdarr?.flows ?? []
  }

  compareAndPlan(
    current: StoredFlow[],
    desired: TdarrFlow[],
    _context: StepContext,
  ): ChangeRecord[] {
    const changes: ChangeRecord[] = []

    for (const flow of desired) {
      const have = findFlow(current, flow)

      if (!have) {
        changes.push({ type: 'create', resource: 'tdarr-flow', identifier: identity(flow) })
      } else if (!declaredMatches(have, desiredFlow(flow))) {
        changes.push({
          type: 'update',
          resource: 'tdarr-flow',
          identifier: identity(flow),
          details: { id: have._id },
        })
      }
    }

    return changes
  }

  async executeChanges(changes: ChangeRecord[], context: StepContext): Promise<StepResult> {
    const errors: Error[] = []
    const warnings: Warning[] = []
    const results: ChangeRecord[] = []
    const client = context.tdarrClient

    if (changes.length === 0 || !client) {
      return { success: true, changes: results, errors, warnings }
    }

    const current = await this.readCurrentState(context)
    const planned = new Set(changes.map((c) => c.identifier))
    let created = 0

    for (const flow of this.getDesiredState(context)) {
      if (!planned.has(identity(flow))) {
        continue
      }

      try {
        const have = findFlow(current, flow)

        if (!have) {
          const id = flow._id ?? generateId()
          const document = {
            isUiLocked: false,
            ...desiredFlow(flow),
            // Flows are ordered by priority in the UI; a new one goes last
            // unless it says otherwise.
            priority: flow.priority ?? current.length + created,
          }

          logger.info('Creating Tdarr flow', { id, name: flow.name })
          await client.insert(COLLECTION, id, document)
          created += 1
          results.push({
            type: 'create',
            resource: 'tdarr-flow',
            identifier: identity(flow),
            details: { id },
          })
          continue
        }

        const body = updateBody(have, desiredFlow(flow))
        logger.info('Updating Tdarr flow', {
          id: have._id,
          name: flow.name,
          keys: Object.keys(body),
        })
        await client.update(COLLECTION, have._id, body)
        results.push({
          type: 'update',
          resource: 'tdarr-flow',
          identifier: identity(flow),
          details: { id: have._id },
        })
      } catch (error) {
        errors.push(toError(error))
      }
    }

    return { success: errors.length === 0, changes: results, errors, warnings }
  }

  async verifySuccess(context: StepContext): Promise<boolean> {
    const current = await this.readCurrentState(context)
    return this.compareAndPlan(current, this.getDesiredState(context), context).length === 0
  }
}
