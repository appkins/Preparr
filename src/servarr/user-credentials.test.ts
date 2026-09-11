import { describe, expect, test } from 'bun:test'
import {
  credentialSchemeFor,
  hashPassword,
  newSalt,
  passwordMatches,
  userColumns,
} from './user-credentials'

describe('credentialSchemeFor', () => {
  test('selects the salt-free scheme for readarr', () => {
    expect(credentialSchemeFor('readarr')).toBe('sha256')
  })

  test('selects the salted scheme for every other servarr app', () => {
    for (const type of ['sonarr', 'radarr', 'lidarr', 'prowlarr'] as const) {
      expect(credentialSchemeFor(type)).toBe('pbkdf2')
    }
  })
})

describe('userColumns', () => {
  test('omits Salt and Iterations for the sha256 scheme', () => {
    // Readarr's Users table predates salted hashing and has neither column,
    // so selecting them fails the whole query with 42703.
    expect(userColumns('sha256')).toEqual(['Id', 'Identifier', 'Username', 'Password'])
  })

  test('includes Salt and Iterations for the pbkdf2 scheme', () => {
    expect(userColumns('pbkdf2')).toEqual([
      'Id',
      'Identifier',
      'Username',
      'Password',
      'Salt',
      'Iterations',
    ])
  })
})

describe('hashPassword', () => {
  test('hashes sha256 as lowercase hex, matching Readarr password.SHA256Hash()', async () => {
    // Well-known digest of "password"; Readarr stores exactly this string.
    expect(await hashPassword('sha256', 'password')).toBe(
      '5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8',
    )
  })

  test('hashes pbkdf2 as base64 and depends on the salt', async () => {
    const salt = new Uint8Array(16).fill(7)
    const other = new Uint8Array(16).fill(9)

    const hash = await hashPassword('pbkdf2', 'password', salt)

    expect(hash).toMatch(/^[A-Za-z0-9+/]+=*$/)
    expect(await hashPassword('pbkdf2', 'password', salt)).toBe(hash)
    expect(await hashPassword('pbkdf2', 'password', other)).not.toBe(hash)
  })
})

describe('newSalt', () => {
  test('returns no salt for the sha256 scheme', () => {
    expect(newSalt('sha256')).toBeNull()
  })

  test('returns 16 random bytes for the pbkdf2 scheme', () => {
    const salt = newSalt('pbkdf2')
    expect(salt).toBeInstanceOf(Uint8Array)
    expect(salt?.length).toBe(16)
  })
})

describe('passwordMatches', () => {
  test('compares sha256 without needing a salt', async () => {
    const stored = await hashPassword('sha256', 'correct')

    expect(await passwordMatches('sha256', 'correct', { Password: stored })).toBe(true)
    expect(await passwordMatches('sha256', 'wrong', { Password: stored })).toBe(false)
  })

  test('compares pbkdf2 using the stored salt', async () => {
    const salt = new Uint8Array(16).fill(3)
    const stored = {
      Password: await hashPassword('pbkdf2', 'correct', salt),
      Salt: Buffer.from(salt).toString('base64'),
    }

    expect(await passwordMatches('pbkdf2', 'correct', stored)).toBe(true)
    expect(await passwordMatches('pbkdf2', 'wrong', stored)).toBe(false)
  })

  test('reports no match when a pbkdf2 salt is missing rather than throwing', async () => {
    expect(await passwordMatches('pbkdf2', 'anything', { Password: 'x' })).toBe(false)
  })
})
