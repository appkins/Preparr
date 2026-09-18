import type { TdarrLibrary } from '@/config/schema'
import {
  type ChangeRecord,
  ConfigurationStep,
  type StepContext,
  type StepResult,
  type Warning,
} from '@/core/step'
import type { TdarrClient, TdarrDocument } from '@/tdarr/client'
import { findFlow, generateId } from '@/tdarr/flow-payload'
import { desiredLibrary, newLibraryDocument, normalizePath } from '@/tdarr/library-payload'
import { changedKeys, declaredMatches, updateBody } from '@/tdarr/match'
import { libraryScope, planVariables, type TdarrVariable } from '@/tdarr/variables'
import { toError } from '@/utils/errors'
import { logger } from '@/utils/logger'
import { applyVariablePlan } from './tdarr-variables'

const LIBRARIES = 'LibrarySettingsJSONDB'

type StoredLibrary = TdarrDocument & { name: string; folder?: string; folderWatching?: boolean }
type StoredFlow = TdarrDocument & { name: string }

interface Current {
  libraries: StoredLibrary[]
  flows: StoredFlow[]
  variables: TdarrVariable[]
}

/**
 * Reconcile libraries, and the variables scoped to each.
 *
 * Matched by name: Tdarr assigns the id at creation and nothing in
 * configuration can know it. A new library is built from the template the UI
 * uses, since the server has no create call and assumes every key is there.
 *
 * Two things about a library are actions, not fields. Folder watching is a
 * child process the server starts from the flag at boot and from an explicit
 * toggle at any other time, so a change to the flag -- or to the folder it
 * watches -- is followed by the toggle. And a library knows nothing of its
 * files until it is scanned, so a new one is given a scan for new files.
 *
 * A library Tdarr has that is not declared is left alone, files and all.
 */
export class TdarrLibrariesStep extends ConfigurationStep {
  readonly name = 'tdarr-libraries'
  readonly description = 'Reconcile Tdarr libraries'
  readonly dependencies: string[] = ['tdarr-connectivity', 'tdarr-flows']
  readonly mode: 'init' | 'sidecar' | 'both' = 'sidecar'

  validatePrerequisites(context: StepContext): boolean {
    return !!context.tdarrClient && this.getDesiredState(context).length > 0
  }

  async readCurrentState(context: StepContext): Promise<Current> {
    const client = context.tdarrClient
    const current: Current = { libraries: [], flows: [], variables: [] }
    if (!client) {
      return current
    }

    try {
      current.libraries = await client.getAll<StoredLibrary>(LIBRARIES)
      current.flows = await client.getAll<StoredFlow>('FlowsJSONDB')
      current.variables = await client.getAll<TdarrVariable & { _id: string }>('VariablesJSONDB')
    } catch (error) {
      // Left as read so far rather than thrown: a create is then planned and
      // the failure surfaces from the write with the reason attached.
      logger.debug('Could not read Tdarr libraries', { error })
    }

    return current
  }

  protected getDesiredState(context: StepContext): TdarrLibrary[] {
    return context.config.app?.tdarr?.libraries ?? []
  }

  /** The flow id a library asks for, or the reason it cannot have one. */
  private resolveFlow(
    current: Current,
    library: TdarrLibrary,
  ): { flowId?: string | undefined; error?: string } {
    if (library.flow === undefined) {
      return {}
    }
    const flow = findFlow(current.flows, library.flow)
    return flow
      ? { flowId: flow._id }
      : { error: `Tdarr flow "${library.flow}" for library ${library.name} does not exist` }
  }

  compareAndPlan(current: Current, desired: TdarrLibrary[], _context: StepContext): ChangeRecord[] {
    const changes: ChangeRecord[] = []

    for (const library of desired) {
      const have = current.libraries.find((l) => l.name === library.name)
      const { flowId, error } = this.resolveFlow(current, library)

      if (error) {
        // Planned so that execution reports it; a plan cannot fail on its own.
        changes.push({
          type: have ? 'update' : 'create',
          resource: 'tdarr-library',
          identifier: library.name,
          details: { error },
        })
        continue
      }

      const want = desiredLibrary(library, flowId)

      if (!have) {
        changes.push({ type: 'create', resource: 'tdarr-library', identifier: library.name })
      } else if (!declaredMatches(have, want)) {
        changes.push({
          type: 'update',
          resource: 'tdarr-library',
          identifier: library.name,
          details: { id: have._id, keys: changedKeys(have, want) },
        })
      }

      // Variables of a library that does not exist yet are all creates; the
      // scope needs the id, which is only known once it does.
      const plan = have
        ? planVariables(current.variables, library.variables, libraryScope(have._id))
        : planVariables([], library.variables, 'pending')

      for (const v of plan.create) {
        changes.push({
          type: 'create',
          resource: 'tdarr-library-variable',
          identifier: `${library.name}/${v.key}`,
        })
      }
      for (const v of plan.update) {
        changes.push({
          type: 'update',
          resource: 'tdarr-library-variable',
          identifier: `${library.name}/${v.key}`,
        })
      }
    }

    return changes
  }

  private async createLibrary(
    client: TdarrClient,
    library: TdarrLibrary,
    options: { priority: number; flowId?: string | undefined },
  ): Promise<string> {
    const id = generateId()
    const document = newLibraryDocument(library, { id, ...options })
    const folder = document.folder as string

    logger.info('Creating Tdarr library', { id, name: library.name, folder })
    await client.insert(LIBRARIES, id, document)

    if (document.folderWatching === true) {
      await client.toggleFolderWatch(id, folder, true)
    }
    await client.scanFiles(id, 'scanFindNew', folder)

    return id
  }

  private async updateLibrary(
    client: TdarrClient,
    have: StoredLibrary,
    library: TdarrLibrary,
    flowId: string | undefined,
  ): Promise<void> {
    const body = updateBody(have, desiredLibrary(library, flowId))

    // The watcher is a process keyed by folder. It has to be stopped on the
    // old folder and started on the new one, or stopped and started as the
    // flag changes; the document alone changes nothing until the next boot.
    const watchingBefore = have.folderWatching === true
    const watchingAfter = (body.folderWatching as boolean | undefined) ?? watchingBefore
    const folderBefore = normalizePath(have.folder ?? '')
    const folderAfter = (body.folder as string | undefined) ?? folderBefore

    logger.info('Updating Tdarr library', {
      id: have._id,
      name: library.name,
      keys: Object.keys(body),
    })
    await client.update(LIBRARIES, have._id, body)

    if (watchingBefore && (!watchingAfter || folderAfter !== folderBefore)) {
      await client.toggleFolderWatch(have._id, folderBefore, false)
    }
    if (watchingAfter && (!watchingBefore || folderAfter !== folderBefore)) {
      await client.toggleFolderWatch(have._id, folderAfter, true)
    }
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
    const planned = new Set(
      changes.filter((c) => c.resource === 'tdarr-library').map((c) => c.identifier),
    )
    const plannedVariables = new Set(
      changes
        .filter((c) => c.resource === 'tdarr-library-variable')
        .map((c) => c.identifier.split('/')[0]),
    )
    let created = 0

    for (const library of this.getDesiredState(context)) {
      if (!planned.has(library.name) && !plannedVariables.has(library.name)) {
        continue
      }

      try {
        const { flowId, error } = this.resolveFlow(current, library)
        if (error) {
          throw new Error(error)
        }

        let have = current.libraries.find((l) => l.name === library.name)

        if (planned.has(library.name)) {
          if (!have) {
            const id = await this.createLibrary(client, library, {
              priority: current.libraries.length + created,
              flowId,
            })
            created += 1
            have = { _id: id, name: library.name }
            results.push({
              type: 'create',
              resource: 'tdarr-library',
              identifier: library.name,
              details: { id },
            })
          } else {
            await this.updateLibrary(client, have, library, flowId)
            results.push({
              type: 'update',
              resource: 'tdarr-library',
              identifier: library.name,
              details: { id: have._id },
            })
          }
        }

        if (have && plannedVariables.has(library.name)) {
          const plan = planVariables(current.variables, library.variables, libraryScope(have._id))
          await applyVariablePlan(client, plan)
          for (const v of plan.create) {
            results.push({
              type: 'create',
              resource: 'tdarr-library-variable',
              identifier: `${library.name}/${v.key}`,
            })
          }
          for (const v of plan.update) {
            results.push({
              type: 'update',
              resource: 'tdarr-library-variable',
              identifier: `${library.name}/${v.key}`,
            })
          }
        }
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
