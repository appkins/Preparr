import { beforeEach, describe, expect, test } from 'bun:test'
import type { SQL } from 'bun'
import type { PostgresConfig } from '@/config/schema'
import { POOL_MAX, PostgresClient, type SqlFactory } from './client'

/**
 * A stand-in for Bun's SQL that records how it was opened.
 *
 * The pooling bug this guards against is invisible from query results -- it is
 * about which connection strings get opened and how many sockets each pool is
 * allowed -- so the factory, not the queries, is what the tests observe.
 */
function recordingFactory(rows: unknown[] = [{ connected: 1 }]) {
  const opened: Array<{ url: string; max: number }> = []

  const factory: SqlFactory = (url, options) => {
    opened.push({ url, max: options.max })

    const sql = (() => Promise.resolve(rows)) as unknown as SQL
    ;(sql as unknown as { unsafe: () => Promise<unknown[]> }).unsafe = () => Promise.resolve([])
    ;(sql as unknown as { close: () => void }).close = () => {
      /* nothing to release: the fake holds no socket */
    }
    return sql
  }

  return { factory, opened, databases: () => opened.map((o) => o.url.split('/').pop()) }
}

describe('PostgresClient', () => {
  let client: PostgresClient
  const mockConfig: PostgresConfig = {
    host: 'localhost',
    port: 5432,
    username: 'testuser',
    password: 'testpass',
    database: 'testdb',
    logDatabaseEnabled: true,
    skipProvisioning: false,
  }

  beforeEach(() => {
    client = new PostgresClient(mockConfig)
  })

  test('creates PostgreSQL client instance', () => {
    expect(client).toBeDefined()
    expect(client).toBeInstanceOf(PostgresClient)
  })

  // Skip connection string test since getConnectionString is private
  test.skip('generates correct connection string', () => {
    // Would require exposing private method or refactoring for testability
  })

  // Skip SQL-dependent tests that require actual database connection
  test.skip('connect creates database connections', () => {
    // Would require SQL mock
  })

  test.skip('connect is idempotent', () => {
    // Would require SQL mock
  })

  test.skip('close cleans up connections', () => {
    // Would require SQL mock
  })

  test('close handles null connections gracefully', () => {
    // Should not throw when no connections exist
    expect(() => client.close()).not.toThrow()
  })

  // Skip withRetry test since it's a private method
  test.skip('withRetry retries on failure', () => {
    // Would require exposing private method or integration testing
  })

  // Skip withRetry test since it's a private method
  test.skip('withRetry throws after max retries', () => {
    // Would require exposing private method or integration testing
  })

  // Skip withRetry test since it's a private method
  test.skip('withRetry respects delay parameters', () => {
    // Would require exposing private method or integration testing
  })

  // Skip withRetry test since it's a private method
  test.skip('withRetry respects max delay', () => {
    // Would require exposing private method or integration testing
  })

  describe('connection pooling', () => {
    test('testConnection probes the application database, not the maintenance database', async () => {
      const { factory, databases } = recordingFactory()
      const skipping = new PostgresClient({ ...mockConfig, skipProvisioning: true }, factory)

      await skipping.testConnection()

      expect(databases()).toContain('testdb')
      expect(databases()).not.toContain('postgres')
    })

    test('provisioning still opens the maintenance database', async () => {
      const { factory, databases } = recordingFactory([])
      const provisioning = new PostgresClient(mockConfig, factory)

      await provisioning.createDatabase('somedb')

      expect(databases()).toContain('postgres')
    })

    test('caps every pool so a long-lived sidecar cannot hold connections open', async () => {
      const { factory, opened } = recordingFactory([])
      const capped = new PostgresClient(mockConfig, factory)

      await capped.createDatabase('somedb')

      expect(opened.length).toBeGreaterThan(0)
      for (const pool of opened) {
        expect(pool.max).toBe(POOL_MAX)
      }
      // Bun's own default is 10; a cap equal to it would not be a cap.
      expect(POOL_MAX).toBeLessThan(10)
    })
  })

  // Note: The actual database operations (testConnection, createDatabase, etc.)
  // would require a real database connection or more complex mocking.
  // These tests focus on the client logic and retry mechanism.
})
