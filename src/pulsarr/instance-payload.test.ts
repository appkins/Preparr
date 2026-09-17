import { describe, expect, test } from 'bun:test'
import { instanceMatches, type PulsarrInstance } from './instance-payload'

const sonarr = (overrides: Partial<PulsarrInstance> = {}): PulsarrInstance => ({
  name: 'Sonarr',
  baseUrl: 'http://sonarr:8989',
  apiKey: 'a'.repeat(32),
  ...overrides,
})

describe('instanceMatches', () => {
  test('an instance that declares nothing beyond the basics matches one Pulsarr has defaulted', () => {
    // Pulsarr answers with every field filled in from its own defaults. Only
    // what was actually asked for may be compared, or the first reconcile
    // after a create always reports a change.
    const current = {
      id: 1,
      name: 'Sonarr',
      baseUrl: 'http://sonarr:8989',
      apiKey: 'a'.repeat(32),
      bypassIgnored: false,
      seasonMonitoring: 'all',
      monitorNewItems: 'all',
      searchOnAdd: true,
      createSeasonFolders: false,
      seriesType: 'standard',
      tags: [],
      isDefault: false,
    }

    expect(instanceMatches(current, sonarr())).toBe(true)
  })

  test('a declared field that differs is a change', () => {
    const current = { id: 1, ...sonarr(), rootFolder: '/data/media/tv' }

    expect(instanceMatches(current, sonarr({ rootFolder: '/data/media/anime' }))).toBe(false)
  })

  test('a masked api key is no evidence of a change', () => {
    // Pulsarr returns the key it holds; were it ever to redact one, a literal
    // comparison would rewrite the instance on every pass. Same rule as the
    // Servarr download clients.
    const current = { id: 1, ...sonarr(), apiKey: '********' }

    expect(instanceMatches(current, sonarr())).toBe(true)
  })

  test('quality profile compares as text, whichever way round the types fall', () => {
    // The API takes a name or an id and answers with whichever it stored.
    const current = { id: 1, ...sonarr(), qualityProfile: 4 }

    expect(instanceMatches(current, sonarr({ qualityProfile: '4' }))).toBe(true)
  })

  test('tags compare as a set, not as an ordered list', () => {
    const current = { id: 1, ...sonarr(), tags: ['anime', 'hd'] }

    expect(instanceMatches(current, sonarr({ tags: ['hd', 'anime'] }))).toBe(true)
  })

  test('a tag that is genuinely absent is a change', () => {
    const current = { id: 1, ...sonarr(), tags: ['hd'] }

    expect(instanceMatches(current, sonarr({ tags: ['hd', 'anime'] }))).toBe(false)
  })
})
