import type { BazarrLanguageProfile } from '@/config/schema'
import {
  BazarrStep,
  type ChangeRecord,
  type StepContext,
  type StepResult,
  type Warning,
} from '@/core/step'
import { toError } from '@/utils/errors'
import { logger } from '@/utils/logger'

interface BazarrLanguageProfileState {
  profileId: number
  name: string
  cutoff: number | null
  items: Array<{
    language: string
    forced: boolean
    hi: boolean
    audio_exclude: boolean
    audio_only_include: boolean
  }>
  mustContain: string
  mustNotContain: string
}

/**
 * Whether Bazarr's default-profile settings actually need writing.
 *
 * configureDefaultProfiles used to run on every reconcile, on the grounds that
 * it is idempotent. It is idempotent in outcome but not in effect: it POSTs
 * Bazarr's settings form, and Bazarr re-establishes its Sonarr and Radarr
 * SignalR feeds whenever settings are saved. A cycle reporting changeCount 0
 * therefore still reconnected both, every CONFIG_RECONCILE_INTERVAL, and each
 * reconnect made Bazarr re-sync to catch up on events it might have missed.
 *
 * Ids are compared as text because Bazarr has returned both a number and a
 * string for these across versions.
 */
export function defaultProfilesNeedWrite(
  general: Record<string, unknown>,
  profileIdByName: Map<string, number>,
  desired: { series?: string | undefined; movies?: string | undefined },
): boolean {
  const needs = (name: string | undefined, enabledKey: string, profileKey: string): boolean => {
    if (!name) return false

    const id = profileIdByName.get(name)
    if (id === undefined) return true

    if (general[enabledKey] !== true) return true

    return String(general[profileKey] ?? '') !== String(id)
  }

  return (
    needs(desired.series, 'serie_default_enabled', 'serie_default_profile') ||
    needs(desired.movies, 'movie_default_enabled', 'movie_default_profile')
  )
}

export class BazarrLanguageProfilesStep extends BazarrStep {
  readonly name = 'bazarr-language-profiles'
  readonly description = 'Configure Bazarr language profiles'
  readonly dependencies: string[] = ['bazarr-languages']
  readonly mode: 'init' | 'sidecar' | 'both' = 'sidecar'

  private getProfilesConfig(context: StepContext): BazarrLanguageProfile[] {
    return context.config.app?.bazarr?.languageProfiles ?? []
  }

  private getDefaultProfilesConfig(context: StepContext): {
    series: string | undefined
    movies: string | undefined
  } {
    // Check for profile-level default flag first
    const profiles = this.getProfilesConfig(context)
    const defaultProfile = profiles.find((p) => p.default)
    if (defaultProfile) {
      return { series: defaultProfile.name, movies: defaultProfile.name }
    }

    // Fall back to explicit defaultProfiles config
    const defaults = context.config.app?.bazarr?.defaultProfiles
    return {
      series: defaults?.series,
      movies: defaults?.movies,
    }
  }

  validatePrerequisites(context: StepContext): boolean {
    return this.getProfilesConfig(context).length > 0
  }

  async readCurrentState(_context: StepContext): Promise<BazarrLanguageProfileState[]> {
    try {
      const profiles = await this.client.getLanguageProfiles()
      return profiles.map((p) => ({
        profileId: p.profileId,
        name: p.name,
        cutoff: p.cutoff,
        items: p.items.map((item) => ({
          language: item.language,
          forced: item.forced === 'True',
          hi: item.hi === 'True',
          audio_exclude: item.audio_exclude === 'True',
          audio_only_include: item.audio_only_include === 'True',
        })),
        mustContain: p.mustContain,
        mustNotContain: p.mustNotContain,
      }))
    } catch (error) {
      logger.debug('Failed to read Bazarr language profiles state', { error })
      return []
    }
  }

  protected getDesiredState(context: StepContext): BazarrLanguageProfile[] {
    return this.getProfilesConfig(context)
  }

  compareAndPlan(
    current: BazarrLanguageProfileState[],
    desired: BazarrLanguageProfile[],
  ): ChangeRecord[] {
    const changes: ChangeRecord[] = []

    const currentByName = new Map(current.map((p) => [p.name, p]))
    const desiredNames = new Set(desired.map((p) => p.name))

    // Check for new profiles or updates
    for (const profile of desired) {
      const existing = currentByName.get(profile.name)

      if (!existing) {
        changes.push({
          type: 'create',
          resource: 'bazarr-language-profile',
          identifier: profile.name,
          details: { itemCount: profile.items.length },
        })
      } else {
        // Check if profile needs update
        const needsUpdate = this.profileNeedsUpdate(existing, profile)
        if (needsUpdate) {
          changes.push({
            type: 'update',
            resource: 'bazarr-language-profile',
            identifier: profile.name,
            details: { itemCount: profile.items.length },
          })
        }
      }
    }

    // Check for profiles to remove (not in desired state)
    for (const name of currentByName.keys()) {
      if (!desiredNames.has(name)) {
        changes.push({
          type: 'delete',
          resource: 'bazarr-language-profile',
          identifier: name,
        })
      }
    }

    return changes
  }

  private profileNeedsUpdate(
    current: BazarrLanguageProfileState,
    desired: BazarrLanguageProfile,
  ): boolean {
    // Compare cutoff
    if (current.cutoff !== (desired.cutoff ?? null)) return true

    // Compare mustContain/mustNotContain
    if (current.mustContain !== (desired.mustContain ?? '')) return true
    if (current.mustNotContain !== (desired.mustNotContain ?? '')) return true

    // Compare items
    if (current.items.length !== desired.items.length) return true

    for (let i = 0; i < current.items.length; i++) {
      const currentItem = current.items[i]
      const desiredItem = desired.items[i]

      if (!currentItem || !desiredItem) return true
      if (currentItem.language !== desiredItem.language) return true
      if (currentItem.forced !== (desiredItem.forced ?? false)) return true
      if (currentItem.hi !== (desiredItem.hi ?? false)) return true
      if (currentItem.audio_exclude !== (desiredItem.audio_exclude ?? false)) return true
      if (currentItem.audio_only_include !== (desiredItem.audio_only_include ?? false)) return true
    }

    return false
  }

  async executeChanges(changes: ChangeRecord[], context: StepContext): Promise<StepResult> {
    const errors: Error[] = []
    const warnings: Warning[] = []

    try {
      if (changes.length > 0) {
        const desired = this.getDesiredState(context)
        logger.info('Configuring Bazarr language profiles...', {
          profileCount: desired.length,
        })

        await this.client.configureLanguageProfiles(desired)

        logger.info('Bazarr language profiles configured successfully', {
          profiles: desired.map((p) => p.name).join(', '),
        })
      }

      // Only when they differ. See defaultProfilesNeedWrite: writing these
      // unconditionally costs a settings save, and a settings save costs two
      // SignalR reconnects.
      const defaultProfiles = this.getDefaultProfilesConfig(context)
      if (defaultProfiles.series || defaultProfiles.movies) {
        const profiles = await this.client.getLanguageProfiles()
        const profileIdByName = new Map(profiles.map((p) => [p.name, p.profileId]))
        const settings = await this.client.getSettings()
        const general = (settings.general ?? {}) as Record<string, unknown>

        if (defaultProfilesNeedWrite(general, profileIdByName, defaultProfiles)) {
          await this.client.configureDefaultProfiles(defaultProfiles.series, defaultProfiles.movies)
        }
      }

      // Bulk-assign profile to existing media with no profile
      const applyProfile = this.getProfilesConfig(context).find((p) => p.applyToExisting)
      if (applyProfile) {
        await this.applyProfileToExistingMedia(applyProfile.name, context)
      }

      return {
        success: true,
        changes,
        errors,
        warnings,
      }
    } catch (error) {
      const err = toError(error)
      errors.push(err)
      logger.error('Failed to configure Bazarr language profiles', {
        error: err.message,
      })
      return {
        success: false,
        changes,
        errors,
        warnings,
      }
    }
  }

  private async applyProfileToExistingMedia(
    profileName: string,
    _context: StepContext,
  ): Promise<void> {
    const profiles = await this.client.getLanguageProfiles()
    const profile = profiles.find((p) => p.name === profileName)
    if (!profile) {
      logger.warn('Cannot apply profile to existing media: profile not found', {
        name: profileName,
      })
      return
    }

    const profileId = profile.profileId

    // Assign to series with no profile
    const series = await this.client.getSeries()
    const unassignedSeries = series.filter((s) => s.profileId == null).map((s) => s.sonarrSeriesId)
    if (unassignedSeries.length > 0) {
      logger.info('Assigning default profile to unassigned series...', {
        count: unassignedSeries.length,
        profileName,
      })
      await this.client.assignSeriesProfiles(unassignedSeries, profileId)
    }

    // Assign to movies with no profile
    const movies = await this.client.getMovies()
    const unassignedMovies = movies.filter((m) => m.profileId == null).map((m) => m.radarrId)
    if (unassignedMovies.length > 0) {
      logger.info('Assigning default profile to unassigned movies...', {
        count: unassignedMovies.length,
        profileName,
      })
      await this.client.assignMoviesProfiles(unassignedMovies, profileId)
    }

    if (unassignedSeries.length === 0 && unassignedMovies.length === 0) {
      logger.debug('All media already has a profile assigned')
    }
  }

  async verifySuccess(context: StepContext): Promise<boolean> {
    try {
      const current = await this.readCurrentState(context)
      const desired = this.getDesiredState(context)

      if (desired.length === 0) return true

      const currentNames = new Set(current.map((p) => p.name))
      return desired.every((profile) => currentNames.has(profile.name))
    } catch {
      return false
    }
  }
}
