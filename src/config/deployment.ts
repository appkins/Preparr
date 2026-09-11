/**
 * Deployment-shape questions that several places need to agree on.
 */

/**
 * Types that are not Servarr apps: they expose no Servarr API and are reached
 * through their own `services.*` entry instead. Building a ServarrManager for
 * one would point it at an endpoint that does not exist.
 */
const NON_SERVARR_TYPES = new Set(['qbittorrent', 'bazarr', 'sabnzbd'])

export function hasServarrApi(type: string): boolean {
  return !NON_SERVARR_TYPES.has(type)
}
