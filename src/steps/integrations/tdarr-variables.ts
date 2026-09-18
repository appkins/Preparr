import {
  type ChangeRecord,
  ConfigurationStep,
  type StepContext,
  type StepResult,
  type Warning,
} from '@/core/step'
import type { TdarrClient } from '@/tdarr/client'
import { generateId } from '@/tdarr/flow-payload'
import {
  planVariables,
  type TdarrVariable,
  type VariablePlan,
  type VariableValues,
} from '@/tdarr/variables'
import { toError } from '@/utils/errors'
import { logger } from '@/utils/logger'

const COLLECTION = 'VariablesJSONDB'

/**
 * Write the planned variables. Shared with the libraries step, which plans
 * the same way for its library-scoped variables.
 */
export async function applyVariablePlan(client: TdarrClient, plan: VariablePlan): Promise<void> {
  for (const variable of plan.create) {
    logger.info('Creating Tdarr variable', { key: variable.key, type: variable.type })
    await client.insert(COLLECTION, generateId(), { ...variable, date: Date.now() })
  }
  for (const variable of plan.update) {
    logger.info('Updating Tdarr variable', { key: variable.key, type: variable.type })
    await client.update(COLLECTION, variable._id, { value: variable.value })
  }
}

/**
 * Reconcile the global user variables -- the values flows read as
 * {{{args.userVariables.global.<key>}}}, which is where a flow's Radarr or
 * Sonarr API key belongs rather than in the flow itself.
 */
export class TdarrVariablesStep extends ConfigurationStep {
  readonly name = 'tdarr-variables'
  readonly description = 'Reconcile Tdarr global variables'
  readonly dependencies: string[] = ['tdarr-connectivity']
  readonly mode: 'init' | 'sidecar' | 'both' = 'sidecar'

  validatePrerequisites(context: StepContext): boolean {
    return !!context.tdarrClient && Object.keys(this.getDesiredState(context)).length > 0
  }

  async readCurrentState(context: StepContext): Promise<TdarrVariable[]> {
    const client = context.tdarrClient
    if (!client) {
      return []
    }

    try {
      return await client.getAll<TdarrVariable & { _id: string }>(COLLECTION)
    } catch (error) {
      logger.debug('Could not list Tdarr variables', { error })
      return []
    }
  }

  protected getDesiredState(context: StepContext): VariableValues {
    return context.config.app?.tdarr?.variables ?? {}
  }

  compareAndPlan(
    current: TdarrVariable[],
    desired: VariableValues,
    _context: StepContext,
  ): ChangeRecord[] {
    const plan = planVariables(current, desired, 'global')
    return [
      ...plan.create.map(
        (v): ChangeRecord => ({ type: 'create', resource: 'tdarr-variable', identifier: v.key }),
      ),
      ...plan.update.map(
        (v): ChangeRecord => ({ type: 'update', resource: 'tdarr-variable', identifier: v.key }),
      ),
    ]
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
      // Re-planned against a fresh read rather than replayed from the change
      // list, so an id assigned between planning and now is the one written to.
      const plan = planVariables(
        await this.readCurrentState(context),
        this.getDesiredState(context),
        'global',
      )
      await applyVariablePlan(client, plan)
      results.push(
        ...this.compareAndPlan(
          [],
          Object.fromEntries(plan.create.map((v) => [v.key, v.value])),
          context,
        ),
      )
      results.push(
        ...plan.update.map(
          (v): ChangeRecord => ({ type: 'update', resource: 'tdarr-variable', identifier: v.key }),
        ),
      )
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
