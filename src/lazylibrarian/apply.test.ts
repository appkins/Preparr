import { describe, expect, test } from 'bun:test'
import { applyConfigFile } from './apply'

function io(initial: string | null) {
  const state = { text: initial, writes: 0 }
  return {
    state,
    read: () => Promise.resolve(state.text),
    write: (text: string) => {
      state.text = text
      state.writes++
      return Promise.resolve()
    },
  }
}

const desired = { General: { EBOOK_DIR: '/data/media/books' } }

describe('applyConfigFile', () => {
  test('writes the settings into an existing file', async () => {
    const f = io('[General]\nebook_dir = /old\n')

    const result = await applyConfigFile(desired, f)

    expect(result.changed).toBe(true)
    expect(f.state.text).toContain('ebook_dir = /data/media/books')
  })

  test('creates the file when the application has not written one yet', async () => {
    const f = io(null)

    const result = await applyConfigFile(desired, f)

    expect(result.changed).toBe(true)
    expect(f.state.text).toContain('[General]')
  })

  test('writes nothing when the file already says what was asked for', async () => {
    // Rewriting an unchanged file on every run is how a settled reconciler
    // ends up churning, and here it would also fight the application, which
    // rewrites this file itself.
    const f = io('[General]\nebook_dir = /data/media/books\n')

    const result = await applyConfigFile(desired, f)

    expect(result.changed).toBe(false)
    expect(f.state.writes).toBe(0)
  })

  test('an unrelated setting is not a reason to rewrite', async () => {
    const f = io('[General]\nebook_dir = /data/media/books\nsomething = else\n\n[Git]\nx = 1\n')

    const result = await applyConfigFile(desired, f)

    expect(result.changed).toBe(false)
    expect(f.state.writes).toBe(0)
  })

  test('an unrelated setting survives a write caused by something else', async () => {
    const f = io('[General]\nebook_dir = /old\nsomething = else\n\n[Git]\nx = 1\n')

    await applyConfigFile(desired, f)

    expect(f.state.text).toContain('something = else')
    expect(f.state.text).toContain('[Git]')
  })
})
