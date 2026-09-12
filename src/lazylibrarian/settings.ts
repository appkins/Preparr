/**
 * PrepArr's LazyLibrarian configuration, expressed as config.ini settings.
 *
 * The key names are LazyLibrarian's own, taken from its configdefs. They are
 * grouped by the section the application puts them in, which is not always the
 * obvious one: a download client is configured in its own section but switched
 * on by a flag in USENET or TORRENT, and leaving that flag unset gives a
 * client that is fully configured and never used.
 */

import type { LazyLibrarianConfig } from '@/config/schema'

type Settings = Record<string, Record<string, string>>

const bool = (value: boolean): string => (value ? '1' : '0')

/** Only set what was actually given: an empty string is a value to this app. */
function put(
  settings: Settings,
  section: string,
  values: Record<string, string | number | undefined>,
): void {
  const target = settings[section] ?? {}

  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) {
      target[key] = String(value)
    }
  }

  if (Object.keys(target).length > 0) {
    settings[section] = target
  }
}

export function settingsFor(config: LazyLibrarianConfig): Settings {
  const settings: Settings = {}

  put(settings, 'General', {
    EBOOK_DIR: config.ebookDir,
    AUDIO_DIR: config.audioDir,
    DOWNLOAD_DIR: config.downloadDir,
  })

  if (config.apiKey) {
    // The key alone does nothing; the API has to be switched on as well, and
    // Prowlarr cannot reach the instance until it is.
    put(settings, 'API', { API_ENABLED: '1', API_KEY: config.apiKey })
  }

  if (config.comics) {
    put(settings, 'Comics', {
      COMIC_TAB: bool(config.comics.enabled),
      CV_APIKEY: config.comics.comicVineApiKey,
    })
  }

  if (config.sabnzbd) {
    put(settings, 'USENET', { NZB_DOWNLOADER_SABNZBD: '1' })
    put(settings, 'SABnzbd', {
      SAB_HOST: config.sabnzbd.host,
      SAB_PORT: config.sabnzbd.port,
      SAB_API: config.sabnzbd.apiKey,
      SAB_CAT: config.sabnzbd.category,
      SAB_USER: config.sabnzbd.username,
      SAB_PASS: config.sabnzbd.password,
    })
  }

  if (config.qbittorrent) {
    put(settings, 'TORRENT', { TOR_DOWNLOADER_QBITTORRENT: '1' })
    put(settings, 'QBITTORRENT', {
      QBITTORRENT_HOST: config.qbittorrent.host,
      QBITTORRENT_PORT: config.qbittorrent.port,
      QBITTORRENT_USER: config.qbittorrent.username,
      QBITTORRENT_PASS: config.qbittorrent.password,
      QBITTORRENT_LABEL: config.qbittorrent.label,
      QBITTORRENT_DIR: config.qbittorrent.directory,
    })
  }

  if (config.calibre) {
    // Two separate questions: whether anything is filed into Calibre, and
    // whether that goes through a content server. Running calibredb against a
    // library directory is the usual answer to the second and needs nothing
    // listening, so the two are not tied together.
    put(settings, 'Calibre', {
      IMP_CALIBRE_EBOOK: bool(config.calibre.enabled),
      IMP_CALIBRE_COMIC: bool(config.calibre.enabled && (config.comics?.enabled ?? false)),

      CALIBRE_USE_SERVER: bool(config.calibre.useServer),
      CALIBRE_SERVER: config.calibre.server,
      CALIBRE_USER: config.calibre.username,
      CALIBRE_PASS: config.calibre.password,
      IMP_CALIBREDB: config.calibre.databasePath,
    })
  }

  for (const [section, values] of Object.entries(config.extra ?? {})) {
    put(settings, section, values)
  }

  return settings
}
