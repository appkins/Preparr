/**
 * Whether a custom format already matches what was asked for.
 *
 * The app does not hand back what it was given. A specification returns with
 * an implementationName and an infoLink it chose, and every field returns
 * carrying order, label, helpText, type, advanced, privacy and isFloat --
 * eight attributes describing how to draw the field in a form, none of which
 * were ever sent.
 *
 * Comparing the two documents literally therefore never matched, so every
 * custom format was rewritten on every reconcile: hundreds of pointless
 * writes an hour, and a log in which nothing is ever settled.
 *
 * So only what a deployment actually states is compared, and only against the
 * same thing on the other side. Anything the app adds is its own business.
 */

interface ComparableField {
  name?: string | null
  value?: unknown
}

interface ComparableSpecification {
  name: string
  implementation: string
  negate?: boolean
  required?: boolean
  fields?: ComparableField[] | null
}

interface ComparableFormat {
  includeCustomFormatWhenRenaming?: boolean
  specifications?: ComparableSpecification[] | null
}

/**
 * Compared as text so that a number read back as a number still matches the
 * number that was sent, and a field written as "5" matches one returned as 5.
 */
function sameValue(a: unknown, b: unknown): boolean {
  return String(a) === String(b)
}

function fieldsMatch(current: ComparableField[], desired: ComparableField[]): boolean {
  const have = new Map(current.map((field) => [field.name, field.value]))

  // Only the declared fields are checked. The app reports every field the
  // specification supports, including ones this format never set.
  return desired.every(
    (field) => have.has(field.name) && sameValue(have.get(field.name), field.value),
  )
}

function specificationMatches(
  current: ComparableSpecification,
  desired: ComparableSpecification,
): boolean {
  return (
    current.implementation === desired.implementation &&
    (current.negate ?? false) === (desired.negate ?? false) &&
    (current.required ?? false) === (desired.required ?? false) &&
    fieldsMatch(current.fields ?? [], desired.fields ?? [])
  )
}

export function customFormatMatches(current: ComparableFormat, desired: ComparableFormat): boolean {
  if (
    (current.includeCustomFormatWhenRenaming ?? false) !==
    (desired.includeCustomFormatWhenRenaming ?? false)
  ) {
    return false
  }

  const currentSpecs = current.specifications ?? []
  const desiredSpecs = desired.specifications ?? []

  if (currentSpecs.length !== desiredSpecs.length) {
    return false
  }

  // Matched by name rather than by position: the app is free to return them
  // in its own order, and a reordering is not a change.
  const have = new Map(currentSpecs.map((spec) => [spec.name, spec]))

  return desiredSpecs.every((spec) => {
    const existing = have.get(spec.name)
    return existing !== undefined && specificationMatches(existing, spec)
  })
}
