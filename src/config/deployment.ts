/**
 * Deployment-shape questions that several places need to agree on.
 */

/**
 * Types that are not Servarr apps: they expose no Servarr API and are reached
 * through their own `services.*` entry instead.
 *
 * This list is the only copy. It existed three times over -- here, in the
 * schema's two refinements, and in the merger's validator -- and they drifted
 * apart twice. SABnzbd was missing from one and survived only because the
 * deployment happened to supply a URL and a password it never used;
 * LazyLibrarian was missing from this one, so a ServarrManager was built for
 * it and sat waiting for an API that does not exist to answer, for ever.
 */
const NON_SERVARR_TYPES = new Set([
  'qbittorrent',
  'bazarr',
  'sabnzbd',
  'lazylibrarian',
  'pulsarr',
  'tdarr',
])

/**
 * An absent type counts as a Servarr app: the schema defaults it to "auto",
 * which is one, and answering false would quietly skip the checks that a
 * configuration missing its type most needs.
 */
export function hasServarrApi(type: string | undefined): boolean {
  return !NON_SERVARR_TYPES.has(type ?? '')
}

/**
 * Types that keep no state in Postgres and so need no credentials for it.
 *
 * Deliberately a separate list from NON_SERVARR_TYPES rather than a reuse of
 * it: exposing no Servarr API and keeping no Postgres state are different
 * questions, and Bazarr answers them differently -- it has no Servarr API but
 * does store its configuration in Postgres. Tdarr is here because it carries
 * its own database and never sees these credentials at all.
 */
const NON_POSTGRES_TYPES = new Set(['qbittorrent', 'tdarr'])

/**
 * An absent type counts as needing Postgres, for the same reason an absent
 * type counts as a Servarr app: the default is one, and answering false would
 * skip a check that a configuration missing its type most needs.
 */
export function usesPostgres(type: string | undefined): boolean {
  return !NON_POSTGRES_TYPES.has(type ?? '')
}
