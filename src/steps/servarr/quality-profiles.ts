import type { QualityProfile } from '@/config/schema'
import {
  type ChangeRecord,
  ServarrStep,
  type StepContext,
  type StepResult,
  type Warning,
} from '@/core/step'
import {
  buildQualityProfile,
  type DesiredProfile,
  type ProfileSchema,
} from '@/servarr/quality-profile-builder'
import { toError } from '@/utils/errors'
import { logger } from '@/utils/logger'

type CurrentProfile = ProfileSchema & { id: number }

/**
 * What this step actually controls on a profile.
 *
 * Compared as a signature rather than field by field so that everything the
 * instance owns -- ids, language, the qualities left disabled -- does not read
 * as drift on every pass.
 */
interface ProfileSignature {
  qualities: string[]
  cutoff: string | undefined
  scores: Record<string, number>
}

export class QualityProfilesStep extends ServarrStep {
  readonly name = 'quality-profiles'
  readonly description = 'Configure Servarr quality profiles'
  // custom-formats first: a profile scores formats by name, and a name the
  // instance does not have yet fails the build rather than scoring nothing.
  readonly dependencies: string[] = ['servarr-connectivity', 'custom-formats']
  readonly mode: 'init' | 'sidecar' | 'both' = 'sidecar'

  validatePrerequisites(context: StepContext): boolean {
    if (context.servarrType === 'prowlarr') return false
    return this.client.isReady()
  }

  async readCurrentState(_context: StepContext): Promise<CurrentProfile[]> {
    try {
      return await this.client.getQualityProfiles()
    } catch (error) {
      logger.warn('Failed to read current quality profiles', { error })
      return []
    }
  }

  protected getDesiredState(context: StepContext): QualityProfile[] {
    // A profile with no qualities named cannot be built from the instance
    // schema, so it is left to whatever already defines it.
    return (context.config.app?.qualityProfiles ?? []).filter((p) => p.qualities.length > 0)
  }

  private toDesired(profile: QualityProfile): DesiredProfile {
    return {
      name: profile.name,
      qualities: profile.qualities,
      cutoffQuality: profile.cutoffQuality,
      upgradeAllowed: profile.upgradeAllowed,
      minFormatScore: profile.minFormatScore,
      cutoffFormatScore: profile.cutoffFormatScore,
      scores: Object.fromEntries(profile.formatItems.map((f) => [f.format, f.score])),
    }
  }

  private signatureOfCurrent(profile: CurrentProfile): ProfileSignature {
    const name = (item: { name?: string | null; quality?: { name: string } | null }) =>
      item.name ?? item.quality?.name ?? ''

    const id = (item: { id?: number; quality?: { id: number } | null }) =>
      item.quality?.id ?? item.id

    return {
      // Reversed so it reads most-preferred first, the order a profile is
      // written in.
      qualities: profile.items
        .filter((item) => item.allowed)
        .map(name)
        .reverse(),
      cutoff: profile.items.find((item) => id(item) === profile.cutoff)
        ? name(profile.items.find((item) => id(item) === profile.cutoff) as never)
        : undefined,
      scores: Object.fromEntries(
        profile.formatItems.filter((f) => f.score !== 0).map((f) => [f.name, f.score]),
      ),
    }
  }

  private signatureOfDesired(desired: DesiredProfile): ProfileSignature {
    const scores = desired.scores ?? {}

    return {
      qualities: desired.qualities,
      cutoff: desired.cutoffQuality ?? desired.qualities[0],
      scores: Object.fromEntries(Object.entries(scores).filter(([, score]) => score !== 0)),
    }
  }

  private same(a: ProfileSignature, b: ProfileSignature): boolean {
    const normalise = (s: ProfileSignature) =>
      JSON.stringify({
        qualities: s.qualities,
        cutoff: s.cutoff,
        scores: Object.fromEntries(Object.entries(s.scores).sort(([x], [y]) => x.localeCompare(y))),
      })

    return normalise(a) === normalise(b)
  }

  compareAndPlan(
    current: CurrentProfile[],
    desired: QualityProfile[],
    _context: StepContext,
  ): ChangeRecord[] {
    const changes: ChangeRecord[] = []

    for (const profile of desired) {
      const existing = current.find((p) => p.name === profile.name)

      if (!existing) {
        changes.push({
          type: 'create',
          resource: 'quality-profile',
          identifier: profile.name,
          details: { qualities: profile.qualities.length },
        })
        continue
      }

      if (
        !this.same(
          this.signatureOfCurrent(existing),
          this.signatureOfDesired(this.toDesired(profile)),
        )
      ) {
        changes.push({
          type: 'update',
          resource: 'quality-profile',
          identifier: profile.name,
          details: { id: existing.id },
        })
      }
    }

    // Profiles this deployment does not declare are left alone: an instance
    // ships with its own, and media is assigned to them.
    return changes
  }

  async executeChanges(changes: ChangeRecord[], context: StepContext): Promise<StepResult> {
    const results: ChangeRecord[] = []
    const errors: Error[] = []
    const warnings: Warning[] = []

    if (changes.length === 0) {
      return { success: true, changes: results, errors, warnings }
    }

    const desired = this.getDesiredState(context)
    const schema = await this.client.getQualityProfileSchema()
    const current = await this.readCurrentState(context)

    for (const change of changes) {
      try {
        const profile = desired.find((p) => p.name === change.identifier)
        if (!profile) {
          errors.push(new Error(`Quality profile not found in desired state: ${change.identifier}`))
          continue
        }

        const payload = buildQualityProfile(schema, this.toDesired(profile))

        if (change.type === 'create') {
          await this.client.addQualityProfile(payload)
          logger.info('Quality profile created', { name: profile.name })
        } else {
          const existing = current.find((p) => p.name === profile.name)
          if (!existing) {
            errors.push(new Error(`Quality profile disappeared before update: ${profile.name}`))
            continue
          }

          // Built from the schema, so it carries every quality and format the
          // instance knows; the existing id is what makes it an update.
          await this.client.updateQualityProfile(existing.id, { ...payload, id: existing.id })
          logger.info('Quality profile updated', { name: profile.name, id: existing.id })
        }

        results.push(change)
      } catch (error) {
        const stepError = toError(error)
        errors.push(stepError)
        logger.error('Failed to manage quality profile', {
          error: stepError.message,
          name: change.identifier,
        })
      }
    }

    return { success: errors.length === 0, changes: results, errors, warnings }
  }

  async verifySuccess(context: StepContext): Promise<boolean> {
    try {
      const current = await this.readCurrentState(context)
      const names = new Set(current.map((p) => p.name))

      return this.getDesiredState(context).every((p) => names.has(p.name))
    } catch (error) {
      logger.debug('Quality profiles verification failed', { error })
      return false
    }
  }
}
