/**
 * Build a quality profile payload from the instance's own profile schema.
 *
 * GET /api/vN/qualityprofile/schema returns a blank profile carrying every
 * quality the app knows, already arranged into the groups it ships with
 * ("WEB 1080p" over WEBDL-1080p and WEBRip-1080p), and every custom format
 * currently defined, scored zero.
 *
 * Building from that rather than from literal ids is what lets a deployment
 * name qualities and formats instead of numbering them: the ids are assigned
 * per instance, differ between Radarr and Sonarr, and a profile written
 * against the wrong ones is accepted and silently wrong.
 */

export interface SchemaQuality {
  id: number
  name: string
}

export interface ProfileSchemaItem {
  quality?: SchemaQuality | null
  id?: number
  name?: string | null
  allowed: boolean
  items?: ProfileSchemaItem[]
}

export interface ProfileFormatItem {
  format: number
  name: string
  score: number
}

export interface ProfileSchema {
  name: string
  upgradeAllowed: boolean
  cutoff: number
  items: ProfileSchemaItem[]
  minFormatScore: number
  cutoffFormatScore: number
  formatItems: ProfileFormatItem[]
  [key: string]: unknown
}

export interface DesiredProfile {
  name: string

  /** Quality or group names, most preferred first. */
  qualities: string[]

  /** Defaults to the most preferred quality. */
  cutoffQuality?: string | undefined

  upgradeAllowed?: boolean | undefined
  minFormatScore?: number | undefined
  cutoffFormatScore?: number | undefined

  /** Scores by custom format name. */
  scores?: Record<string, number> | undefined
}

/** A group carries its name directly; a plain quality carries it underneath. */
function itemName(item: ProfileSchemaItem): string | undefined {
  return item.name ?? item.quality?.name ?? undefined
}

/** A group is identified by its own id, a plain quality by the quality's. */
function itemId(item: ProfileSchemaItem): number | undefined {
  return item.quality?.id ?? item.id
}

export function buildQualityProfile(
  schema: ProfileSchema,
  desired: DesiredProfile,
): ProfileSchema & { name: string } {
  const wanted = new Set(desired.qualities)

  const missing = desired.qualities.filter(
    (name) => !schema.items.some((item) => itemName(item) === name),
  )
  if (missing.length > 0) {
    throw new Error(
      `Quality profile "${desired.name}" names qualities this instance does not have: ${missing.join(', ')}`,
    )
  }

  // Enabling a group without enabling the qualities inside it produces a group
  // that matches nothing, so the members follow their group.
  const setAllowed = (item: ProfileSchemaItem, allowed: boolean): ProfileSchemaItem => ({
    ...item,
    allowed,
    ...(item.items ? { items: item.items.map((inner) => ({ ...inner, allowed })) } : {}),
  })

  const selected = schema.items.filter((item) => wanted.has(itemName(item) ?? ''))
  const rest = schema.items.filter((item) => !wanted.has(itemName(item) ?? ''))

  // The API ranks by position: later is better. The config lists best first,
  // so the selection is reversed onto the end and everything else kept below.
  const byPreference = [...desired.qualities]
    .reverse()
    .map((name) => selected.find((item) => itemName(item) === name))
    .filter((item): item is ProfileSchemaItem => item !== undefined)

  const items = [
    ...rest.map((item) => setAllowed(item, false)),
    ...byPreference.map((item) => setAllowed(item, true)),
  ]

  const cutoffName = desired.cutoffQuality ?? desired.qualities[0]
  const cutoffItem = items.find((item) => itemName(item) === cutoffName)
  const cutoff = cutoffItem ? itemId(cutoffItem) : undefined

  if (cutoff === undefined) {
    throw new Error(
      `Quality profile "${desired.name}" has no quality named ${cutoffName} to cut off at`,
    )
  }

  const scores = desired.scores ?? {}
  const unknownFormats = Object.keys(scores).filter(
    (name) => !schema.formatItems.some((item) => item.name === name),
  )
  if (unknownFormats.length > 0) {
    throw new Error(
      `Quality profile "${desired.name}" scores custom formats that do not exist: ${unknownFormats.join(', ')}`,
    )
  }

  return {
    ...schema,
    name: desired.name,
    upgradeAllowed: desired.upgradeAllowed ?? schema.upgradeAllowed,
    cutoff,
    items,
    minFormatScore: desired.minFormatScore ?? schema.minFormatScore,
    cutoffFormatScore: desired.cutoffFormatScore ?? schema.cutoffFormatScore,
    formatItems: schema.formatItems.map((item) => ({
      ...item,
      score: scores[item.name] ?? 0,
    })),
  }
}
