/**
 * Import list fields that belong to the instance rather than to the config.
 *
 * Every Trakt list type authenticates with OAuth: the resource carries an
 * accessToken, a refreshToken, an expiry and the account that authorised, and
 * they exist only because somebody completed a browser sign-in against that
 * instance. No configuration can produce them, and there is no headless way
 * to obtain them -- the app starts the flow itself through its own registered
 * Trakt application.
 *
 * So they are read from the instance and written back untouched. Sending the
 * config's empty values instead would sign the instance out on the first
 * reconcile and leave a list that looks configured and imports nothing; and
 * comparing them would find a difference on every pass that no write could
 * ever settle.
 */

export interface ListField {
  name?: string | null
  value?: unknown
}

export interface ComparableImportList {
  implementation?: string
  configContract?: string
  fields?: ListField[] | null
}

/** Set by the application, never by a deployment. */
const INSTANCE_OWNED = new Set(['accesstoken', 'refreshtoken', 'expires', 'authuser'])

function isInstanceOwned(name: string | null | undefined): boolean {
  return typeof name === 'string' && INSTANCE_OWNED.has(name.toLowerCase())
}

/**
 * The fields to send: the configuration's, plus any token the instance holds
 * that the configuration does not set itself.
 */
export function withInstanceOwnedFields(current: ListField[], desired: ListField[]): ListField[] {
  const declared = new Set(desired.map((field) => field.name?.toLowerCase()))

  const carried = current.filter(
    (field) => isInstanceOwned(field.name) && !declared.has(field.name?.toLowerCase()),
  )

  return [...desired, ...carried]
}

/** Compared as text, so a number returned as a string is not a difference. */
function sameValue(a: unknown, b: unknown): boolean {
  return String(a) === String(b)
}

export function importListMatches(
  current: ComparableImportList,
  desired: ComparableImportList,
): boolean {
  if (desired.implementation !== undefined && current.implementation !== desired.implementation) {
    return false
  }

  if (desired.configContract !== undefined && current.configContract !== desired.configContract) {
    return false
  }

  const have = new Map(
    (current.fields ?? []).map((field) => [field.name?.toLowerCase(), field.value]),
  )

  // Only what the configuration states, and never the tokens: the instance
  // holds those and the configuration has nothing to say about them.
  return (desired.fields ?? [])
    .filter((field) => !isInstanceOwned(field.name))
    .every((field) => {
      const key = field.name?.toLowerCase()
      return have.has(key) && sameValue(have.get(key), field.value)
    })
}
