import { logger } from '@/utils/logger'
import { mergeIni, renderIni } from './config-file'

/**
 * Apply settings to LazyLibrarian's config.ini.
 *
 * Writes only when the file would actually change. That matters more here than
 * elsewhere: LazyLibrarian owns this file and rewrites it whenever anything is
 * changed in its interface, so an unconditional write is not just wasted work
 * but a second writer contending with the application over its own state.
 */

export interface ConfigFileIo {
  /** null when the application has not written its config yet. */
  read(): Promise<string | null>
  write(text: string): Promise<void>
}

export async function applyConfigFile(
  desired: Record<string, Record<string, string>>,
  io: ConfigFileIo,
): Promise<{ changed: boolean }> {
  const existing = (await io.read()) ?? ''
  const merged = renderIni(mergeIni(existing, desired))

  // Compared after rendering both ways round, so that a file differing only
  // in the spelling or layout the application happens to use is not a change.
  const current = renderIni(mergeIni(existing, {}))

  if (current === merged) {
    return { changed: false }
  }

  await io.write(merged)
  logger.info('LazyLibrarian configuration file updated', {
    sections: Object.keys(desired).length,
  })

  return { changed: true }
}
