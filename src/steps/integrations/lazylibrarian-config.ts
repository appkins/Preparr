import type { LazyLibrarianConfig } from '@/config/schema'
import {
  type ChangeRecord,
  ConfigurationStep,
  type StepContext,
  type StepResult,
  type Warning,
} from '@/core/step'
import { applyConfigFile, type ConfigFileIo } from '@/lazylibrarian/apply'
import { settingsFor } from '@/lazylibrarian/settings'
import { toError } from '@/utils/errors'
import { logger } from '@/utils/logger'

/**
 * Write LazyLibrarian's config.ini before the application starts.
 *
 * This is the only moment a file edit works. LazyLibrarian reads config.ini
 * once at startup and its loadCFG API command is a no-op -- the implementation
 * is a comment saying the configuration need not be reloaded -- so nothing
 * written to the file afterwards is ever seen by the running process.
 *
 * It is also the only way to reach the settings that let the API be used at
 * all: the API is off by default and its key lives in this file, so without
 * this the sidecar has nothing to authenticate with.
 */
export class LazyLibrarianConfigFileStep extends ConfigurationStep {
  readonly name = 'lazylibrarian-config-file'
  readonly description = 'Write the LazyLibrarian configuration file'
  readonly dependencies: string[] = []
  readonly mode: 'init' | 'sidecar' | 'both' = 'init'

  constructor(private readonly io?: ConfigFileIo) {
    super()
  }

  validatePrerequisites(context: StepContext): boolean {
    return !!context.config.app?.lazylibrarian && !!this.configPath(context)
  }

  private configPath(context: StepContext): string | undefined {
    return context.config.app?.lazylibrarian?.configPath
  }

  private fileIo(context: StepContext): ConfigFileIo {
    if (this.io) {
      return this.io
    }

    const path = this.configPath(context) as string

    return {
      // Absent rather than empty when the application has not run yet, so a
      // first start is not mistaken for an empty configuration.
      read: async () => {
        const file = Bun.file(path)
        return (await file.exists()) ? file.text() : null
      },
      write: async (text: string) => {
        await Bun.write(path, text)
      },
    }
  }

  readCurrentState(_context: StepContext): Promise<{ written: boolean }> {
    return Promise.resolve({ written: false })
  }

  protected getDesiredState(context: StepContext): LazyLibrarianConfig | undefined {
    return context.config.app?.lazylibrarian
  }

  compareAndPlan(
    _current: { written: boolean },
    desired: LazyLibrarianConfig | undefined,
    _context: StepContext,
  ): ChangeRecord[] {
    if (!desired) {
      return []
    }

    return [
      {
        type: 'update',
        resource: 'lazylibrarian-config',
        identifier: 'config.ini',
        details: {},
      },
    ]
  }

  async executeChanges(changes: ChangeRecord[], context: StepContext): Promise<StepResult> {
    const errors: Error[] = []
    const warnings: Warning[] = []
    const results: ChangeRecord[] = []

    const desired = this.getDesiredState(context)
    if (changes.length === 0 || !desired) {
      return { success: true, changes: results, errors, warnings }
    }

    try {
      const { changed } = await applyConfigFile(settingsFor(desired), this.fileIo(context))

      if (changed) {
        results.push(changes[0] as ChangeRecord)
        logger.info('LazyLibrarian configuration written', { path: this.configPath(context) })
      } else {
        logger.debug('LazyLibrarian configuration already matches')
      }
    } catch (error) {
      const stepError = toError(error)
      errors.push(stepError)
      logger.error('Failed to write the LazyLibrarian configuration', { error: stepError.message })
    }

    return { success: errors.length === 0, changes: results, errors, warnings }
  }

  verifySuccess(_context: StepContext): Promise<boolean> {
    return Promise.resolve(true)
  }
}
