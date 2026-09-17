import { isMaskedSecret } from '@/servarr/masked'

/**
 * A Sonarr or Radarr instance as Pulsarr stores it.
 *
 * Only the fields this configures are named. Pulsarr fills the rest in from
 * its own defaults and answers with them, and comparing against those would
 * report a change on every pass -- see instanceMatches.
 */
export interface PulsarrInstance {
  name: string
  baseUrl: string
  apiKey: string
  // null as well as undefined: the API accepts an explicit null to clear one,
  // and undefined because the schema's optional fields are exactly that under
  // exactOptionalPropertyTypes.
  qualityProfile?: string | number | null | undefined
  rootFolder?: string | null | undefined
  tags?: string[] | undefined
  isDefault?: boolean | undefined
  bypassIgnored?: boolean | undefined
  searchOnAdd?: boolean | undefined

  /** Sonarr only. */
  seasonMonitoring?: string | undefined
  monitorNewItems?: 'all' | 'none' | undefined
  createSeasonFolders?: boolean | undefined
  seriesType?: 'standard' | 'anime' | 'daily' | undefined

  /** Radarr only. */
  minimumAvailability?: 'announced' | 'inCinemas' | 'released' | undefined
  monitor?: 'movieOnly' | 'movieAndCollection' | 'none' | undefined
}

/** The same instance with the id Pulsarr assigned it. */
export type PulsarrInstanceRecord = PulsarrInstance & { id: number }

/** Pulsarr's own answer, which carries every field whether asked for or not. */
type Current = Record<string, unknown>

/**
 * Whether the instance Pulsarr holds already says what was asked for.
 *
 * Compares only the fields the desired instance actually declares. Pulsarr
 * returns a fully populated object -- seasonMonitoring, seriesType, searchOnAdd
 * and the rest, defaulted -- so a whole-object comparison would differ on the
 * very first pass after a create and rewrite the instance forever after. This
 * is the same failure the Servarr download clients and custom formats had.
 */
export function instanceMatches(current: Current, desired: PulsarrInstance): boolean {
  for (const [key, want] of Object.entries(desired)) {
    if (want === undefined) {
      continue
    }

    const have = current[key]

    // A redacted secret says nothing about whether the stored one differs, so
    // it cannot be the reason to rewrite the instance.
    if (typeof have === 'string' && isMaskedSecret(have)) {
      continue
    }

    if (Array.isArray(want)) {
      const mine = [...want].map(String).sort()
      const theirs = [...(Array.isArray(have) ? have : [])].map(String).sort()
      if (mine.length !== theirs.length || mine.some((v, i) => v !== theirs[i])) {
        return false
      }
      continue
    }

    // qualityProfile is a name or an id, and Pulsarr answers with whichever it
    // stored: 4 and "4" are the same instruction.
    if (want === null || have === null) {
      if ((want ?? null) !== (have ?? null)) {
        return false
      }
      continue
    }

    if (String(have) !== String(want)) {
      return false
    }
  }

  return true
}
