import type { TdarrNode } from '@/config/schema'
import {
  type ChangeRecord,
  ConfigurationStep,
  type StepContext,
  type StepResult,
  type Warning,
} from '@/core/step'
import type { TdarrConnectedNode, TdarrDocument } from '@/tdarr/client'
import { declaredMatches, mergeDeclared, type Plain } from '@/tdarr/match'
import { desiredNode, nodeDefaults, type StoredNode } from '@/tdarr/node-payload'
import { toError } from '@/utils/errors'
import { logger } from '@/utils/logger'

const NODES = 'NodeJSONDB'

interface Current {
  connected: Record<string, TdarrConnectedNode>
  stored: (TdarrDocument & StoredNode)[]
  libraries: (TdarrDocument & { name: string })[]
}

/**
 * Reconcile each node's server-side settings, by node name.
 *
 * A node's environment seeds its worker counts once; from then on the
 * server's record for that name is what it runs with. A connected node is
 * updated through the server, which applies the change live and saves it; a
 * node that is not connected is written to its record directly, or given one
 * if it has never registered, and reads it back when it does.
 */
export class TdarrNodesStep extends ConfigurationStep {
  readonly name = 'tdarr-nodes'
  readonly description = 'Reconcile Tdarr node settings'
  readonly dependencies: string[] = ['tdarr-connectivity', 'tdarr-libraries']
  readonly mode: 'init' | 'sidecar' | 'both' = 'sidecar'

  validatePrerequisites(context: StepContext): boolean {
    return !!context.tdarrClient && this.getDesiredState(context).length > 0
  }

  async readCurrentState(context: StepContext): Promise<Current> {
    const client = context.tdarrClient
    const current: Current = { connected: {}, stored: [], libraries: [] }
    if (!client) {
      return current
    }

    try {
      current.connected = await client.getNodes()
      current.stored = await client.getAll<TdarrDocument & StoredNode>(NODES)
      current.libraries = await client.getAll<TdarrDocument & { name: string }>(
        'LibrarySettingsJSONDB',
      )
    } catch (error) {
      logger.debug('Could not read Tdarr nodes', { error })
    }

    return current
  }

  protected getDesiredState(context: StepContext): TdarrNode[] {
    return context.config.app?.tdarr?.nodes ?? []
  }

  /** The node's live record if it is connected, else its saved one. */
  private locate(
    current: Current,
    name: string,
  ): { live?: TdarrConnectedNode; record?: StoredNode } {
    const live = Object.values(current.connected).find((n) => n.nodeName === name)
    if (live) {
      return { live, record: live as StoredNode }
    }
    const stored = current.stored.find((n) => n._id === name)
    return stored ? { record: stored } : {}
  }

  private resolve(
    current: Current,
    node: TdarrNode,
  ): {
    record?: StoredNode | undefined
    live?: TdarrConnectedNode | undefined
    desired?: Plain
    error?: string
  } {
    const { live, record } = this.locate(current, node.name)
    const libraryIds = new Map(current.libraries.map((l) => [l.name, l._id]))

    try {
      return { live, record, desired: desiredNode(node, record, libraryIds) }
    } catch (error) {
      return { live, record, error: toError(error).message }
    }
  }

  compareAndPlan(current: Current, desired: TdarrNode[], _context: StepContext): ChangeRecord[] {
    const changes: ChangeRecord[] = []

    for (const node of desired) {
      const { record, desired: want, error } = this.resolve(current, node)

      if (error || !want) {
        changes.push({
          type: 'update',
          resource: 'tdarr-node',
          identifier: node.name,
          details: { error },
        })
      } else if (!record) {
        changes.push({ type: 'create', resource: 'tdarr-node', identifier: node.name })
      } else if (!declaredMatches(record, want)) {
        changes.push({ type: 'update', resource: 'tdarr-node', identifier: node.name })
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

    for (const change of changes) {
      const node = this.getDesiredState(context).find((n) => n.name === change.identifier)
      if (!node) {
        continue
      }

      try {
        const { live, record, desired, error } = this.resolve(current, node)
        if (error || !desired) {
          throw new Error(error ?? `Could not resolve Tdarr node ${node.name}`)
        }

        if (live) {
          logger.info('Updating connected Tdarr node', {
            name: node.name,
            id: live._id,
            keys: Object.keys(desired),
          })
          await client.updateNode(live._id, desired)
        } else if (record) {
          logger.info('Updating saved Tdarr node settings', {
            name: node.name,
            keys: Object.keys(desired),
          })
          await client.update(NODES, node.name, desired)
        } else {
          logger.info('Seeding Tdarr node settings ahead of its first connection', {
            name: node.name,
          })
          await client.insert(NODES, node.name, mergeDeclared(nodeDefaults(), desired))
        }

        results.push({
          type: record ? 'update' : 'create',
          resource: 'tdarr-node',
          identifier: node.name,
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
