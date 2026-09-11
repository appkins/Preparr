/**
 * Password storage differs across the Servarr family.
 *
 * Sonarr, Radarr, Lidarr and Prowlarr store a salted PBKDF2 hash and carry
 * "Salt" and "Iterations" columns on their Users table. Readarr forked from
 * Lidarr before that change and still stores a bare `password.SHA256Hash()`
 * with neither column, so a query written for the salted schema fails against
 * it with Postgres 42703 (undefined_column) and takes the whole step with it.
 */

/** Salted PBKDF2, as used by every Servarr app except Readarr. */
const PBKDF2_ITERATIONS = 10000
const PBKDF2_KEY_BITS = 256
const PBKDF2_HASH = 'SHA-512'
const SALT_BYTES = 16

export type CredentialScheme = 'pbkdf2' | 'sha256'

/** The subset of a Users row the schemes need to verify a password. */
export interface StoredCredential {
  Password: string
  Salt?: string | null
}

const SHA256_APPS = new Set(['readarr'])

export function credentialSchemeFor(type: string): CredentialScheme {
  return SHA256_APPS.has(type) ? 'sha256' : 'pbkdf2'
}

/**
 * Columns that exist on the Users table under a given scheme. Selecting a
 * column the table does not have fails the entire statement, so this is the
 * list a SELECT must be built from rather than a fixed one.
 */
export function userColumns(scheme: CredentialScheme): string[] {
  const base = ['Id', 'Identifier', 'Username', 'Password']
  return scheme === 'sha256' ? base : [...base, 'Salt', 'Iterations']
}

/** A fresh salt, or null for schemes that do not use one. */
export function newSalt(scheme: CredentialScheme): Uint8Array | null {
  return scheme === 'sha256' ? null : crypto.getRandomValues(new Uint8Array(SALT_BYTES))
}

export async function hashPassword(
  scheme: CredentialScheme,
  password: string,
  salt?: Uint8Array | null,
): Promise<string> {
  if (scheme === 'sha256') {
    // Readarr's SHA256Hash() is lowercase hex over the UTF-8 bytes.
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password))
    return Buffer.from(digest).toString('hex')
  }

  if (!salt) {
    throw new Error('pbkdf2 password hashing requires a salt')
  }

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )

  // Copy onto a plain ArrayBuffer: deriveBits rejects a view backed by a
  // SharedArrayBuffer, which is what Buffer.from() can hand back.
  const saltBuffer = new Uint8Array(salt.slice(0)) as Uint8Array<ArrayBuffer>

  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBuffer, iterations: PBKDF2_ITERATIONS, hash: PBKDF2_HASH },
    key,
    PBKDF2_KEY_BITS,
  )

  return Buffer.from(derived).toString('base64')
}

/**
 * Whether `password` is the one already stored. Returns false rather than
 * throwing when the stored value cannot be interpreted, so a caller treats an
 * unreadable credential as "needs updating" instead of failing outright.
 */
export async function passwordMatches(
  scheme: CredentialScheme,
  password: string,
  stored: StoredCredential,
): Promise<boolean> {
  try {
    if (scheme === 'sha256') {
      return (await hashPassword('sha256', password)) === stored.Password
    }

    if (!stored.Salt) {
      return false
    }

    const salt = new Uint8Array(Buffer.from(stored.Salt, 'base64'))
    return (await hashPassword('pbkdf2', password, salt)) === stored.Password
  } catch {
    return false
  }
}
