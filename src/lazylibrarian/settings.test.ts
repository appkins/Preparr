import { describe, expect, test } from 'bun:test'
import { settingsFor } from './settings'

describe('settingsFor', () => {
  test('sets the library paths', () => {
    const s = settingsFor({ ebookDir: '/data/media/books', audioDir: '/data/media/audio' })

    expect(s.General?.EBOOK_DIR).toBe('/data/media/books')
    expect(s.General?.AUDIO_DIR).toBe('/data/media/audio')
  })

  test('leaves a path alone when none was given', () => {
    // An empty string is a real value to LazyLibrarian -- it means "no library
    // directory" -- so an unset path must be absent, not blank.
    expect(settingsFor({ ebookDir: '/x' }).General).not.toHaveProperty('AUDIO_DIR')
  })

  test('turns on the API and sets the key', () => {
    const s = settingsFor({ apiKey: 'abc' })

    expect(s.API?.API_ENABLED).toBe('1')
    expect(s.API?.API_KEY).toBe('abc')
  })

  test('enabling comics shows the tab', () => {
    expect(settingsFor({ comics: { enabled: true } }).Comics?.COMIC_TAB).toBe('1')
  })

  test('comics off is written as off rather than omitted', () => {
    // Omitting would leave a tab someone had enabled by hand, which is not
    // what asking for comics: false means.
    expect(settingsFor({ comics: { enabled: false } }).Comics?.COMIC_TAB).toBe('0')
  })

  test('a ComicVine key is set when supplied', () => {
    const s = settingsFor({ comics: { enabled: true, comicVineApiKey: 'cv' } })

    expect(s.Comics?.CV_APIKEY).toBe('cv')
  })

  test('a SABnzbd client is configured and enabled as the usenet downloader', () => {
    const s = settingsFor({
      sabnzbd: { host: 'sabnzbd', port: 8080, apiKey: 'k', category: 'books' },
    })

    expect(s.USENET?.NZB_DOWNLOADER_SABNZBD).toBe('1')
    expect(s.SABnzbd).toMatchObject({
      SAB_HOST: 'sabnzbd',
      SAB_PORT: '8080',
      SAB_API: 'k',
      SAB_CAT: 'books',
    })
  })

  test('a qBittorrent client is configured and enabled as the torrent downloader', () => {
    const s = settingsFor({
      qbittorrent: {
        host: 'qbittorrent',
        port: 8080,
        username: 'admin',
        password: 'pw',
        label: 'books',
      },
    })

    expect(s.TORRENT?.TOR_DOWNLOADER_QBITTORRENT).toBe('1')
    expect(s.QBITTORRENT).toMatchObject({
      QBITTORRENT_HOST: 'qbittorrent',
      QBITTORRENT_PORT: '8080',
      QBITTORRENT_USER: 'admin',
      QBITTORRENT_PASS: 'pw',
      QBITTORRENT_LABEL: 'books',
    })
  })

  test('no download client means neither downloader is switched on', () => {
    const s = settingsFor({ ebookDir: '/x' })

    expect(s.USENET).toBeUndefined()
    expect(s.TORRENT).toBeUndefined()
  })

  test('Calibre is pointed at its server and told what to import', () => {
    const s = settingsFor({
      calibre: { enabled: true, server: 'http://calibre:8081', databasePath: '/usr/bin/calibredb' },
    })

    expect(s.Calibre).toMatchObject({
      CALIBRE_USE_SERVER: '1',
      CALIBRE_SERVER: 'http://calibre:8081',
      IMP_CALIBREDB: '/usr/bin/calibredb',
      IMP_CALIBRE_EBOOK: '1',
    })
  })

  test('extra settings pass through for anything not modelled', () => {
    const s = settingsFor({ extra: { Postprocess: { KEEP_OPF: '1' } } })

    expect(s.Postprocess?.KEEP_OPF).toBe('1')
  })
})
