/**
 * Comparing a declared document against the one Tdarr holds.
 *
 * Tdarr fills nothing in on the way in and strips nothing on the way out: a
 * library is stored with every key its defaults carry, a flow's edges come
 * back decorated with whatever the editor drew them with, and a node record
 * holds a full hourly schedule nobody declared. Comparing whole documents
 * would therefore report a change on every pass and rewrite everything
 * forever -- the failure the Servarr custom formats and download clients had.
 *
 * So only what was declared is compared, and only against the same thing on
 * the other side, all the way down: an object is matched on its declared
 * keys, an array element by element, and a scalar as text.
 */

export type Plain = Record<string, unknown>

export function isPlainObject(value: unknown): value is Plain {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Scalars compare as text so a number read back as a string is still the
 * number that was sent. null and undefined both mean "nothing there", and
 * nothing there never equals something.
 */
export function sameValue(have: unknown, want: unknown): boolean {
  const haveNothing = have === null || have === undefined
  const wantNothing = want === null || want === undefined
  if (haveNothing || wantNothing) {
    return haveNothing && wantNothing
  }
  return String(have) === String(want)
}

export function declaredMatches(current: unknown, desired: unknown): boolean {
  if (desired === undefined) {
    return true
  }

  if (Array.isArray(desired)) {
    if (!Array.isArray(current) || current.length !== desired.length) {
      return false
    }
    return desired.every((item, index) => declaredMatches(current[index], item))
  }

  if (isPlainObject(desired)) {
    if (!isPlainObject(current)) {
      return false
    }
    return Object.entries(desired).every(
      ([key, want]) => want === undefined || declaredMatches(current[key], want),
    )
  }

  return sameValue(current, desired)
}

/** The declared keys whose value the document does not already hold. */
export function changedKeys(current: Plain | undefined, desired: Plain): string[] {
  return Object.entries(desired)
    .filter(([key, want]) => want !== undefined && !declaredMatches(current?.[key], want))
    .map(([key]) => key)
}

/**
 * The document with the declared values applied.
 *
 * Nested objects are merged rather than replaced, so declaring one flag in a
 * library's decisionMaker does not wipe the dozen beside it; arrays and
 * scalars are taken as given, because a declared list is the whole list.
 */
export function mergeDeclared(current: Plain | undefined, desired: Plain): Plain {
  const merged: Plain = { ...(current ?? {}) }

  for (const [key, want] of Object.entries(desired)) {
    if (want === undefined) {
      continue
    }
    const have = merged[key]
    merged[key] =
      isPlainObject(want) && isPlainObject(have) ? mergeDeclared(have, want) : structuredClone(want)
  }

  return merged
}

/**
 * What to send as an update: only the top-level keys that differ, each with
 * its nested objects merged. Tdarr's update is a shallow merge, so a
 * top-level key that is not sent is left exactly as it was.
 */
export function updateBody(current: Plain | undefined, desired: Plain): Plain {
  const body: Plain = {}
  const merged = mergeDeclared(current, desired)

  for (const key of changedKeys(current, desired)) {
    body[key] = merged[key]
  }

  return body
}
