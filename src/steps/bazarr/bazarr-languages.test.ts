import { describe, expect, test } from 'bun:test'
import { BazarrLanguagesStep } from './bazarr-languages'

// Bazarr's /system/languages returns its whole catalogue -- every ISO language
// it knows -- each carrying an `enabled` flag. Only one is usually on.
const catalogue = [
  { code: 'en', name: 'English', enabled: true },
  { code: 'ab', name: 'Abkhazian', enabled: false },
  { code: 'aa', name: 'Afar', enabled: false },
  { code: 'af', name: 'Afrikaans', enabled: false },
]

describe('BazarrLanguagesStep.compareAndPlan', () => {
  test('a catalogue of disabled languages is not a list of things to delete', () => {
    // The removal loop compared every code Bazarr returned against the desired
    // set, so each of the ~186 languages that merely exist and are switched off
    // was planned for deletion. Nothing converged: the step rewrote the same
    // already-correct language list on every reconcile, and Bazarr reconnects
    // its Sonarr and Radarr SignalR feeds whenever settings are saved -- so a
    // 30 second reconcile interval meant reconnecting to both every 30 seconds,
    // all day.
    const step = new BazarrLanguagesStep()

    const changes = step.compareAndPlan(catalogue, [{ code: 'en', name: 'English', enabled: true }])

    expect(changes).toEqual([])
  })

  test('a language enabled in Bazarr but not declared is still removed', () => {
    const step = new BazarrLanguagesStep()

    const changes = step.compareAndPlan(
      [...catalogue, { code: 'fr', name: 'French', enabled: true }],
      [{ code: 'en', name: 'English', enabled: true }],
    )

    expect(changes).toEqual([{ type: 'delete', resource: 'bazarr-language', identifier: 'fr' }])
  })

  test('a declared language that is off gets enabled', () => {
    const step = new BazarrLanguagesStep()

    const changes = step.compareAndPlan(catalogue, [
      { code: 'af', name: 'Afrikaans', enabled: true },
    ])

    expect(changes.map((c) => [c.type, c.identifier])).toEqual([
      ['update', 'af'],
      ['delete', 'en'],
    ])
  })
})
