import { describe, expect, test } from 'bun:test'
import { mergeIni, parseIni, renderIni } from './config-file'

describe('parseIni', () => {
  test('reads sections and keys', () => {
    const parsed = parseIni('[General]\nebook_dir = /data/books\n\n[API]\napi_enabled = 1\n')

    expect(parsed.get('general')?.get('ebook_dir')?.value).toBe('/data/books')
    expect(parsed.get('api')?.get('api_enabled')?.value).toBe('1')
  })

  test('keeps comments and blank lines out of the way without losing them', () => {
    const parsed = parseIni('# a comment\n[General]\nebook_dir = /x\n')

    expect(parsed.get('general')?.get('ebook_dir')?.value).toBe('/x')
  })

  test('tolerates a value containing an equals sign', () => {
    const parsed = parseIni('[General]\nsearch = a=b\n')

    expect(parsed.get('general')?.get('search')?.value).toBe('a=b')
  })
})

describe('mergeIni', () => {
  test('sets a value in an existing section', () => {
    const out = mergeIni('[General]\nebook_dir = /old\n', {
      General: { ebook_dir: '/data/media/books' },
    })

    expect(renderIni(out)).toContain('ebook_dir = /data/media/books')
    expect(renderIni(out)).not.toContain('/old')
  })

  test('matches an existing key whatever case it was written in', () => {
    // LazyLibrarian reads with optionxform upper() and writes with lower(),
    // so a file can hold either. Matching case-sensitively would append a
    // second key that the app then reads as a duplicate of the first.
    const out = mergeIni('[General]\nEBOOK_DIR = /old\n', {
      General: { ebook_dir: '/new' },
    })

    const text = renderIni(out)
    expect(text).toContain('/new')
    expect(text).not.toContain('/old')
    expect(text.match(/ebook_dir/gi)).toHaveLength(1)
  })

  test('matches an existing section whatever case it was written in', () => {
    const out = mergeIni('[SABnzbd]\nsab_host = old\n', { SABnzbd: { sab_host: 'new' } })

    expect(renderIni(out).match(/\[SABnzbd\]/gi)).toHaveLength(1)
    expect(renderIni(out)).toContain('sab_host = new')
  })

  test('adds a section the file does not have', () => {
    const out = mergeIni('[General]\nebook_dir = /x\n', { Comics: { comic_tab: '1' } })
    const text = renderIni(out)

    expect(text).toContain('[Comics]')
    expect(text).toContain('comic_tab = 1')
  })

  test('leaves every setting it was not asked about alone', () => {
    // The file is the app's own, holding far more than this ever sets.
    const existing =
      '[General]\nebook_dir = /x\nsomething_else = keep me\n\n[Git]\nauto_update = 1\n'
    const text = renderIni(mergeIni(existing, { General: { ebook_dir: '/y' } }))

    expect(text).toContain('something_else = keep me')
    expect(text).toContain('[Git]')
    expect(text).toContain('auto_update = 1')
  })

  test('writes keys in lower case, which is what the app itself writes', () => {
    const text = renderIni(mergeIni('', { General: { EBOOK_DIR: '/x' } }))

    expect(text).toContain('ebook_dir = /x')
    expect(text).not.toContain('EBOOK_DIR')
  })

  test('builds a whole file when there is none yet', () => {
    const text = renderIni(
      mergeIni('', { General: { ebook_dir: '/x' }, API: { api_enabled: '1' } }),
    )

    expect(text).toContain('[General]')
    expect(text).toContain('[API]')
    expect(text).toContain('ebook_dir = /x')
  })
})
