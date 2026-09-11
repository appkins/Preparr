import {
  type ChangeRecord,
  ConfigurationStep,
  type StepContext,
  type StepResult,
  type Warning,
} from '@/core/step'
import { toError } from '@/utils/errors'
import { logger } from '@/utils/logger'

/**
 * Prowlarr tags, indexer proxies, and the tags carried by indexers.
 *
 * All three in one step because they are one dependency chain: a proxy and an
 * indexer both reference tags by id, and Prowlarr assigns those ids, so the
 * tags have to exist and be resolved before either can be written.
 */
export class IndexerProxiesStep extends ConfigurationStep {
  readonly name = 'indexer-proxies'
  readonly description = 'Configure Prowlarr tags, indexer proxies and indexer tags'
  readonly dependencies: string[] = ['indexers']
  readonly mode: 'init' | 'sidecar' | 'both' = 'sidecar'

  validatePrerequisites(context: StepContext): boolean {
    // Indexer proxies exist only in Prowlarr; the other Servarr apps have tags
    // but nothing here to attach them to.
    return !!context.prowlarrExtrasClient && context.servarrType === 'prowlarr'
  }

  /** Every label named anywhere in the config, however it is referenced. */
  private wantedLabels(context: StepContext): string[] {
    const app = context.config.app
    const fromProxies = (app?.indexerProxies ?? []).flatMap((proxy) => proxy.tags ?? [])
    const fromIndexers = Object.values(app?.indexerTags ?? {}).flat()

    return [...new Set([...(app?.tags ?? []), ...fromProxies, ...fromIndexers].filter(Boolean))]
  }

  readCurrentState(_context: StepContext): Promise<{ managed: boolean }> {
    return Promise.resolve({ managed: true })
  }

  protected getDesiredState(context: StepContext): { managed: boolean } {
    const app = context.config.app

    return {
      managed:
        this.wantedLabels(context).length > 0 ||
        (app?.indexerProxies?.length ?? 0) > 0 ||
        Object.keys(app?.indexerTags ?? {}).length > 0,
    }
  }

  compareAndPlan(
    _current: { managed: boolean },
    desired: { managed: boolean },
    context: StepContext,
  ): ChangeRecord[] {
    if (!desired.managed) {
      return []
    }

    const app = context.config.app

    return [
      {
        type: 'update',
        resource: 'indexer-proxies',
        identifier: 'prowlarr',
        details: {
          tags: this.wantedLabels(context).length,
          proxies: app?.indexerProxies?.length ?? 0,
          taggedIndexers: Object.keys(app?.indexerTags ?? {}).length,
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
        const client = context.prowlarrExtrasClient
        if (!client) {
          continue
        }

        const app = context.config.app
        const tagIds = await client.ensureTags(this.wantedLabels(context))

        const proxies = await client.syncIndexerProxies(app?.indexerProxies ?? [], tagIds)
        const indexers = await client.syncIndexerTags(app?.indexerTags ?? {}, tagIds)

        // An indexer PrepArr has not created yet is normal on an early pass;
        // the next reconcile picks it up rather than failing the step.
        if (indexers.skipped.length > 0) {
          logger.info('Indexers not present yet, leaving their tags for a later pass', {
            indexers: indexers.skipped,
          })
        }

        results.push({ ...change, type: 'update' })

        logger.info('Prowlarr extras applied', {
          tags: Object.keys(tagIds).length,
          proxiesCreated: proxies.created.length,
          proxiesUpdated: proxies.updated.length,
          indexersTagged: indexers.tagged.length,
        })
      } catch (error) {
        const stepError = toError(error)
        errors.push(stepError)
        logger.error('Failed to apply Prowlarr extras', { error: stepError.message })
      }
    }

    return { success: errors.length === 0, changes: results, errors, warnings }
  }

  verifySuccess(_context: StepContext): Promise<boolean> {
    return Promise.resolve(true)
  }
}
