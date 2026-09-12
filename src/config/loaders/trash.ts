/**
 * Resolve TRaSH Guides references before any step runs.
 *
 * A deployment names a custom format by trash id; the steps want a format
 * definition and a score against a name. Doing that here rather than inside a
 * step means the guide is read once, the steps stay unaware of it, and a bad
 * id fails while the configuration is being loaded instead of halfway through
 * reconciling an instance.
 */

import type { Config, CustomFormat } from '@/config/schema'
import { scoreFor, type TrashCustomFormat, toCustomFormat } from '@/trash/convert'
import { TrashGuide } from '@/trash/guide'
import { logger } from '@/utils/logger'

/** The apps the guides publish custom formats for. */
const GUIDED_APPS = new Set(['radarr', 'sonarr'])

export interface TrashResolver {
  resolve(trashIds: string[]): Promise<Map<string, TrashCustomFormat>>
}

export async function resolveTrashReferences(
  config: Config,
  resolver?: TrashResolver,
): Promise<Config> {
  const app = config.servarr?.type
  if (!app || !GUIDED_APPS.has(app)) {
    return config
  }

  const profiles = config.app?.qualityProfiles ?? []
  const standalone = config.app?.trashCustomFormats ?? []

  const referenced = [
    ...standalone,
    ...profiles.flatMap((profile) => profile.trashScores.map((entry) => entry.trashId)),
  ]

  if (referenced.length === 0) {
    return config
  }

  const guide = resolver ?? new TrashGuide({ app: app as 'radarr' | 'sonarr' })
  const definitions = await guide.resolve([...new Set(referenced)])

  // Formats already written out by hand win: the config is the more specific
  // statement, and replacing it would silently discard a deliberate edit.
  const customFormats: CustomFormat[] = [...(config.app?.customFormats ?? [])]
  const have = new Set(customFormats.map((format) => format.name))

  for (const id of new Set(referenced)) {
    const definition = definitions.get(id)
    if (!definition) {
      continue
    }

    if (have.has(definition.name)) {
      continue
    }

    customFormats.push(toCustomFormat(definition))
    have.add(definition.name)
  }

  const resolvedProfiles = profiles.map((profile) => {
    const formatItems = [...profile.formatItems]

    for (const entry of profile.trashScores) {
      const definition = definitions.get(entry.trashId)
      if (!definition) {
        continue
      }

      const score = entry.score ?? scoreFor(definition, profile.scoreSet)

      if (score === undefined) {
        // Scoring it zero would be indistinguishable from a deliberate zero,
        // and inventing a number would be worse. The format is still created.
        logger.warn('TRaSH Guides gives this format no score; leaving it unscored', {
          profile: profile.name,
          format: definition.name,
          trashId: entry.trashId,
        })
        continue
      }

      formatItems.push({ format: definition.name, score })
    }

    return { ...profile, formatItems }
  })

  logger.info('Resolved TRaSH Guides references', {
    app,
    formats: definitions.size,
    profiles: resolvedProfiles.length,
  })

  return {
    ...config,
    app: { ...config.app, customFormats, qualityProfiles: resolvedProfiles },
  }
}
