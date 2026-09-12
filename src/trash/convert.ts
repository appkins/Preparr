/**
 * TRaSH Guides definitions, translated into what the Servarr API accepts.
 *
 * The guides publish one JSON per custom format under docs/json/<app>/cf/,
 * each carrying a trash_id, the format's specifications, and a set of scores.
 * Two things in that document do not match the API:
 *
 *  * a specification's `fields` is an object, `{"value": "<regex>"}`, where
 *    Radarr and Sonarr want `[{"name": "value", "value": "<regex>"}]`, and
 *  * scores live in `trash_scores`, keyed by profile, rather than on the
 *    format itself.
 *
 * This is a translation of published data, written against the guides' own
 * format. No code is taken from any tool that consumes them.
 */

import type { CustomFormat, CustomFormatSpecification } from '@/config/schema'

export type TrashFieldValue = string | number | boolean | number[]

export interface TrashSpecification {
  name: string
  implementation: string
  negate?: boolean
  required?: boolean
  fields?: Record<string, TrashFieldValue> | Array<{ name: string; value: TrashFieldValue }>
}

export interface TrashCustomFormat {
  trash_id: string
  name: string
  includeCustomFormatWhenRenaming?: boolean
  trash_scores?: Record<string, number> | undefined
  specifications?: TrashSpecification[]
}

function toFields(
  fields: TrashSpecification['fields'],
): Array<{ name: string; value: TrashFieldValue }> {
  if (!fields) {
    return []
  }

  // Already the API's shape. Some guide entries are written this way, and a
  // definition supplied by hand almost always is.
  if (Array.isArray(fields)) {
    return fields
  }

  return Object.entries(fields).map(([name, value]) => ({ name, value }))
}

export function toCustomFormat(trash: TrashCustomFormat): CustomFormat {
  const specifications: CustomFormatSpecification[] = (trash.specifications ?? []).map((spec) => ({
    name: spec.name,
    implementation: spec.implementation,
    negate: spec.negate ?? false,
    required: spec.required ?? false,
    fields: toFields(spec.fields),
  }))

  return {
    name: trash.name,
    includeCustomFormatWhenRenaming: trash.includeCustomFormatWhenRenaming ?? false,
    specifications,
  }
}

/**
 * The score the guide gives a format.
 *
 * `scoreSet` names one of the guide's alternative score sets -- sqp-1-1080p
 * and friends, which exist precisely to score the same formats differently for
 * a smaller-file profile. A set that does not mention this format falls back
 * to the default rather than to nothing, because the sets are sparse: they
 * list only what they change.
 */
export function scoreFor(trash: TrashCustomFormat, scoreSet?: string): number | undefined {
  const scores = trash.trash_scores
  if (!scores) {
    return undefined
  }

  if (scoreSet !== undefined && scores[scoreSet] !== undefined) {
    return scores[scoreSet]
  }

  return scores.default
}
