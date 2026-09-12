/**
 * Prowlarr refuses a Usenet indexer that does not redirect.
 *
 *   Redirect: Redirect must be enabled for Usenet indexers
 *
 * It cannot proxy a Usenet download the way it proxies a torrent, so the
 * grab has to be handed back to the client as a redirect. The rule is a
 * validation error on create, not a default, so an otherwise complete
 * Newznab definition is rejected outright for a field nobody thinks to set.
 *
 * Newznab is Prowlarr's only Usenet implementation -- Torznab and Cardigann
 * are both torrent -- so the implementation name is enough to know.
 */

const USENET_IMPLEMENTATIONS = new Set(['newznab'])

export interface RedirectDecision {
  implementation: string
  redirect?: boolean | undefined
}

/**
 * Returns undefined for anything that needs no opinion, so the field is left
 * out of the payload entirely and Prowlarr applies its own default.
 */
export function resolveIndexerRedirect(indexer: RedirectDecision): boolean | undefined {
  if (indexer.redirect !== undefined) {
    return indexer.redirect
  }

  return USENET_IMPLEMENTATIONS.has(indexer.implementation.toLowerCase()) ? true : undefined
}

/**
 * Field names whose values are credentials.
 *
 * Matched as substrings and case-insensitively: Prowlarr's definitions spell
 * the same idea as apiKey, passKey, rssKey and api_key across implementations,
 * so an exact-name list would miss most of them.
 */
const SECRET_FIELD_MARKERS = ['key', 'password', 'passkey', 'cookie', 'token', 'secret']

export interface IndexerField {
  // Nullable because the generated client's Field type is: a definition may
  // carry a value with no name, and reading .toLowerCase() off it would throw
  // inside a log call and take the whole indexer create down with it.
  name?: string | null
  value?: unknown
}

/**
 * Mask credential values before a payload is logged.
 *
 * The indexer payload was being written to the log in full at info level,
 * which put every indexer's API key into the pod log in plaintext -- readable
 * by anything that can read logs, and retained for as long as they are.
 */
export function redactSecretFields<T extends IndexerField>(
  fields: T[] | null | undefined,
): T[] | null | undefined {
  if (!fields) {
    return fields
  }

  return fields.map((field) => {
    const name = field.name?.toLowerCase()
    const secret = name !== undefined && SECRET_FIELD_MARKERS.some((m) => name.includes(m))

    return secret ? { ...field, value: '***' } : field
  })
}
