import { describe, expect, test } from 'bun:test'
import type { SQL } from 'bun'
import type { ServarrConfig } from '@/config/schema'
import { ServarrUserManager } from './user-manager'

type Row = Record<string, unknown>

/**
 * Stands in for bun's SQL tagged template. Records the statements issued so a
 * test can assert on the SQL actually sent, and replays canned rows for the
 * first SELECT.
 */
function fakeDb(rows: Row[] = []) {
  const statements: string[] = []

  const db = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.raw.join('?').replace(/\s+/g, ' ').trim()
    statements.push(text)
    void values
    return Promise.resolve(text.startsWith('SELECT') ? rows : [])
  }) as unknown as SQL & { close: () => void }

  db.close = () => undefined

  return { db, statements }
}

function managerFor(type: 'sonarr' | 'readarr', db: SQL) {
  const config = {
    type,
    url: `http://${type}:8787`,
    adminUser: 'admin',
    adminPassword: 'hunter2',
    authenticationMethod: 'forms',
  } as unknown as ServarrConfig

  const manager = new ServarrUserManager(config, false)
  // Seam rather than a constructor change: the production path still builds
  // its own connection from the environment.
  manager.createDatabaseConnection = () => db
  return manager
}

describe('ServarrUserManager.createInitialUser', () => {
  test('does not select Salt or Iterations for readarr', async () => {
    const { db, statements } = fakeDb()

    await managerFor('readarr', db).createInitialUser()

    const select = statements.find((s) => s.startsWith('SELECT'))
    expect(select).toBeDefined()
    expect(select).not.toContain('Salt')
    expect(select).not.toContain('Iterations')
  })

  test('inserts a readarr user without salt columns', async () => {
    const { db, statements } = fakeDb()

    await managerFor('readarr', db).createInitialUser()

    const insert = statements.find((s) => s.startsWith('INSERT'))
    expect(insert).toBeDefined()
    expect(insert).toContain('"Identifier", "Username", "Password"')
    expect(insert).not.toContain('Salt')
  })

  test('still selects and inserts salt columns for sonarr', async () => {
    const { db, statements } = fakeDb()

    await managerFor('sonarr', db).createInitialUser()

    expect(statements.find((s) => s.startsWith('SELECT'))).toContain('Salt')
    expect(statements.find((s) => s.startsWith('INSERT'))).toContain('Salt')
  })

  test('leaves an existing readarr user alone when the password already matches', async () => {
    const { hashPassword } = await import('./user-credentials')
    const { db, statements } = fakeDb([
      {
        Id: 1,
        Identifier: 'abc',
        Username: 'admin',
        Password: await hashPassword('sha256', 'hunter2'),
      },
    ])

    await managerFor('readarr', db).createInitialUser()

    expect(statements.some((s) => s.startsWith('INSERT'))).toBe(false)
    expect(statements.some((s) => s.startsWith('UPDATE'))).toBe(false)
  })

  test('updates a readarr password that no longer matches, without touching Salt', async () => {
    const { hashPassword } = await import('./user-credentials')
    const { db, statements } = fakeDb([
      {
        Id: 1,
        Identifier: 'abc',
        Username: 'admin',
        Password: await hashPassword('sha256', 'the-old-one'),
      },
    ])

    await managerFor('readarr', db).createInitialUser()

    const update = statements.find((s) => s.startsWith('UPDATE'))
    expect(update).toBeDefined()
    expect(update).toContain('"Password"')
    expect(update).not.toContain('Salt')
  })
})

describe('ServarrUserManager.createInitialUserInInitMode', () => {
  test('inserts a readarr user without salt columns', async () => {
    const { db, statements } = fakeDb()

    await managerFor('readarr', db).createInitialUserInInitMode()

    const insert = statements.find((s) => s.startsWith('INSERT'))
    expect(insert).toBeDefined()
    expect(insert).not.toContain('Salt')
    expect(insert).not.toContain('Iterations')
  })

  test('still inserts salt columns for sonarr', async () => {
    const { db, statements } = fakeDb()

    await managerFor('sonarr', db).createInitialUserInInitMode()

    expect(statements.find((s) => s.startsWith('INSERT'))).toContain('Salt')
  })
})
