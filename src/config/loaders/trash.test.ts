import { describe, expect, test } from 'bun:test'
import type { TrashCustomFormat } from '@/trash/convert'
import { resolveTrashReferences } from './trash'

const guideFormats: Record<string, TrashCustomFormat> = {
  aac: {
    trash_id: 'aac',
    name: 'AAC',
    trash_scores: { default: 100, 'sqp-1-1080p': 250 },
    specifications: [
      { name: 'AAC', implementation: 'ReleaseTitleSpecification', fields: { value: 'aac' } },
    ],
  },
  dts: { trash_id: 'dts', name: 'DTS', trash_scores: { default: -1000 }, specifications: [] },
  unscored: { trash_id: 'unscored', name: 'Unscored', specifications: [] },
}

function resolver() {
  const asked: string[][] = []
  return {
    asked,
    resolve: (ids: string[]) => {
      asked.push(ids)
      return Promise.resolve(new Map(ids.map((id) => [id, guideFormats[id] as TrashCustomFormat])))
    },
  }
}

// Only the branches the resolver reads; the real Config is much larger.
const configWith = (app: Record<string, unknown>) =>
  ({
    servarr: { type: 'radarr' },
    app: { customFormats: [], trashCustomFormats: [], qualityProfiles: [], ...app },
    // biome-ignore lint/suspicious/noExplicitAny: a Config stub, not a Config
  }) as any

const profile = (over: Record<string, unknown> = {}) => ({
  name: 'HD',
  qualities: ['Bluray-1080p'],
  formatItems: [],
  trashScores: [],
  minFormatScore: 0,
  cutoffFormatScore: 0,
  upgradeAllowed: true,
  ...over,
})

describe('resolveTrashReferences', () => {
  test('asks the guide for nothing when nothing references it', async () => {
    const r = resolver()
    await resolveTrashReferences(configWith({ qualityProfiles: [profile()] }), r)

    expect(r.asked.flat()).toEqual([])
  })

  test('scores a referenced format at the guide default', async () => {
    const config = configWith({
      qualityProfiles: [profile({ trashScores: [{ trashId: 'aac' }] })],
    })

    const out = await resolveTrashReferences(config, resolver())

    expect(out.app.qualityProfiles[0].formatItems).toEqual([{ format: 'AAC', score: 100 }])
  })

  test('an explicit score overrides the guide', async () => {
    const config = configWith({
      qualityProfiles: [profile({ trashScores: [{ trashId: 'aac', score: 999 }] })],
    })

    const out = await resolveTrashReferences(config, resolver())

    expect(out.app.qualityProfiles[0].formatItems).toEqual([{ format: 'AAC', score: 999 }])
  })

  test('a named score set is read in place of the default', async () => {
    const config = configWith({
      qualityProfiles: [profile({ scoreSet: 'sqp-1-1080p', trashScores: [{ trashId: 'aac' }] })],
    })

    const out = await resolveTrashReferences(config, resolver())

    expect(out.app.qualityProfiles[0].formatItems).toEqual([{ format: 'AAC', score: 250 }])
  })

  test('creates the custom format the profile scores', async () => {
    const config = configWith({
      qualityProfiles: [profile({ trashScores: [{ trashId: 'aac' }] })],
    })

    const out = await resolveTrashReferences(config, resolver())

    expect(out.app.customFormats.map((f: { name: string }) => f.name)).toEqual(['AAC'])
    expect(out.app.customFormats[0].specifications[0].fields).toEqual([
      { name: 'value', value: 'aac' },
    ])
  })

  test('does not duplicate a format the config already defines by hand', async () => {
    const config = configWith({
      customFormats: [{ name: 'AAC', includeCustomFormatWhenRenaming: false, specifications: [] }],
      qualityProfiles: [profile({ trashScores: [{ trashId: 'aac' }] })],
    })

    const out = await resolveTrashReferences(config, resolver())

    expect(out.app.customFormats).toHaveLength(1)
  })

  test('creates a format listed on its own without scoring it anywhere', async () => {
    const config = configWith({ trashCustomFormats: ['dts'] })

    const out = await resolveTrashReferences(config, resolver())

    expect(out.app.customFormats.map((f: { name: string }) => f.name)).toEqual(['DTS'])
  })

  test('creates a format the guide gives no score, but does not invent one', async () => {
    const config = configWith({
      qualityProfiles: [profile({ trashScores: [{ trashId: 'unscored' }] })],
    })

    const out = await resolveTrashReferences(config, resolver())

    expect(out.app.customFormats.map((f: { name: string }) => f.name)).toEqual(['Unscored'])
    // Scoring it zero would be indistinguishable from scoring it deliberately.
    expect(out.app.qualityProfiles[0].formatItems).toEqual([])
  })

  test('keeps format items written by name', async () => {
    const config = configWith({
      qualityProfiles: [
        profile({
          formatItems: [{ format: 'Local', score: 5 }],
          trashScores: [{ trashId: 'aac' }],
        }),
      ],
    })

    const out = await resolveTrashReferences(config, resolver())

    expect(out.app.qualityProfiles[0].formatItems).toEqual([
      { format: 'Local', score: 5 },
      { format: 'AAC', score: 100 },
    ])
  })

  test('leaves an app the guides do not cover alone', async () => {
    const r = resolver()
    const config = configWith({ trashCustomFormats: ['aac'] })
    config.servarr.type = 'qbittorrent'

    await resolveTrashReferences(config, r)

    expect(r.asked.flat()).toEqual([])
  })
})
