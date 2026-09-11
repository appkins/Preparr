import type { RootFolder } from '@/config/schema'

/**
 * Root folders are not the same resource across the Servarr family.
 *
 * Sonarr and Radarr accept a bare path. Readarr and Lidarr inherit a resource
 * that also carries a name and a default quality and metadata profile, and
 * reject a POST without them:
 *
 *   Name: 'Name' must not be empty.
 *   DefaultMetadataProfileId: 'Default Metadata Profile Id' must be greater than '0'.
 *   DefaultQualityProfileId: 'Default Quality Profile Id' must be greater than '0'.
 *
 * The failure is quiet from the outside -- the request 400s, the folder is
 * never created, and the app carries on with an empty library root.
 */

const PROFILE_APPS = new Set(['readarr', 'lidarr'])

/** Whether this app's root folder needs a name and profile ids. */
export function requiresProfiles(type: string): boolean {
  return PROFILE_APPS.has(type)
}

/**
 * Readarr and Lidarr never moved to v3; Sonarr and Radarr did. Prowlarr is v1
 * but has no root folders at all, so it never reaches here.
 */
export function apiVersionFor(type: string): 'v1' | 'v3' {
  return PROFILE_APPS.has(type) || type === 'prowlarr' ? 'v1' : 'v3'
}

export interface ProfileDefaults {
  qualityProfileId: number
  metadataProfileId: number
}

/**
 * The last path segment, ignoring a trailing slash -- an empty name is one of
 * the three things the app refuses.
 */
function nameFromPath(path: string): string {
  const segments = path.split('/').filter(Boolean)
  return segments[segments.length - 1] ?? path
}

export function buildRootFolderBody(
  folder: RootFolder,
  defaults: ProfileDefaults,
): Record<string, unknown> {
  return {
    name: folder.name ?? nameFromPath(folder.path),
    path: folder.path,
    defaultQualityProfileId: folder.defaultQualityProfileId ?? defaults.qualityProfileId,
    defaultMetadataProfileId: folder.defaultMetadataProfileId ?? defaults.metadataProfileId,
    defaultTags: [],
  }
}

export interface Profile {
  id: number
  name: string
}

/**
 * Which profile to attach when the config names none.
 *
 * Readarr ships a metadata profile called "None" that deliberately stores no
 * metadata; picking it by accident gives a library root that works and imports
 * nothing useful. Anything else is preferred, lowest id first, which is the
 * app's own default ("Standard", "eBook") on a fresh instance.
 */
export function pickProfileId(profiles: Profile[]): number {
  const byId = [...profiles].sort((a, b) => a.id - b.id)
  const usable = byId.filter((p) => p.name.toLowerCase() !== 'none')
  const chosen = usable[0] ?? byId[0]

  if (!chosen) {
    throw new Error('No profile available to attach to the root folder')
  }

  return chosen.id
}
