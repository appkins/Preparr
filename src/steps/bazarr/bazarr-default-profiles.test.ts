import { describe, expect, test } from 'bun:test'
import { defaultProfilesNeedWrite } from './bazarr-language-profiles'

const ids = new Map([['English', 1]])
const settled = {
  serie_default_enabled: true,
  serie_default_profile: 1,
  movie_default_enabled: true,
  movie_default_profile: 1,
}

describe('defaultProfilesNeedWrite', () => {
  test('settled defaults need no write', () => {
    // executeChanges called configureDefaultProfiles unconditionally, described
    // in its own comment as idempotent. It is idempotent in outcome but not in
    // effect: it POSTs Bazarr's settings form, and Bazarr re-establishes its
    // Sonarr and Radarr SignalR feeds whenever settings are saved. So a cycle
    // reporting changeCount 0 still reconnected both, every reconcile.
    expect(defaultProfilesNeedWrite(settled, ids, { series: 'English', movies: 'English' })).toBe(
      false,
    )
  })

  test('an id stored as a string is still the same id', () => {
    const general = { ...settled, serie_default_profile: '1' }

    expect(defaultProfilesNeedWrite(general, ids, { series: 'English' })).toBe(false)
  })

  test('a disabled default needs writing', () => {
    const general = { ...settled, serie_default_enabled: false }

    expect(defaultProfilesNeedWrite(general, ids, { series: 'English' })).toBe(true)
  })

  test('a different profile needs writing', () => {
    const general = { ...settled, movie_default_profile: 2 }

    expect(defaultProfilesNeedWrite(general, ids, { movies: 'English' })).toBe(true)
  })

  test('a profile Bazarr does not have yet needs writing', () => {
    expect(defaultProfilesNeedWrite(settled, ids, { series: 'Nordic' })).toBe(true)
  })

  test('nothing configured needs nothing', () => {
    expect(defaultProfilesNeedWrite(settled, ids, {})).toBe(false)
  })
})
