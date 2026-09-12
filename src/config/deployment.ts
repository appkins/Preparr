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
const NON_SERVARR_TYPES = new Set(['qbittorrent', 'bazarr', 'sabnzbd', 'lazylibrarian'])

/**
 * An absent type counts as a Servarr app: the schema defaults it to "auto",
 * which is one, and answering false would quietly skip the checks that a
 * configuration missing its type most needs.
 */
export function hasServarrApi(type: string | undefined): boolean {
  return !NON_SERVARR_TYPES.has(type ?? '')
}
