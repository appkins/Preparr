import { SQL } from 'bun'
import type { PostgresConfig, ServarrConfig } from '@/config/schema'
import { logger } from '@/utils/logger'
import type { ClientWithHostConfig, DatabaseUser, ServarrClientType } from './types'
import {
  type CredentialScheme,
  credentialSchemeFor,
  hashPassword,
  newSalt,
  passwordMatches,
} from './user-credentials'

export class ServarrUserManager {
  private config: ServarrConfig
  private logDatabaseEnabled: boolean

  constructor(config: ServarrConfig, logDatabaseEnabled: boolean) {
    this.config = config
    this.logDatabaseEnabled = logDatabaseEnabled
  }

  /**
   * How this app stores passwords. Readarr predates salted hashing and has no
   * Salt/Iterations columns, so the statements below branch on this rather
   * than assuming the salted schema.
   */
  private get credentialScheme(): CredentialScheme {
    return credentialSchemeFor(this.config.type)
  }

  createDatabaseConnection(database?: string): SQL {
    const mainDbName = database || `${this.config.type}_main`
    const host = process.env.POSTGRES_HOST || 'postgres'
    const port = process.env.POSTGRES_PORT || '5432'
    const password = process.env.POSTGRES_PASSWORD || ''
    const connectionString = `postgres://${this.config.type}:${password}@${host}:${port}/${mainDbName}`

    logger.debug('Creating database connection', {
      type: this.config.type,
      database: mainDbName,
      connectionString: connectionString.replace(password, '***'),
    })

    return new SQL(connectionString)
  }

  private getDatabaseNames(): { main: string; log?: string } {
    return {
      main: `${this.config.type}_main`,
      ...(this.logDatabaseEnabled ? { log: `${this.config.type}_log` } : {}),
    }
  }

  async verifyPostgreSQLConnection(): Promise<boolean> {
    logger.info('Verifying PostgreSQL connection...')

    try {
      const db = this.createDatabaseConnection()
      await db`SELECT 1 as test`
      db.close()

      logger.info('PostgreSQL connection successful', { database: `${this.config.type}_main` })
      return true
    } catch (error) {
      logger.warn('PostgreSQL connection not ready yet', {
        error: error instanceof Error ? error.message : String(error),
      })
      return false
    }
  }

  async checkServarrTablesInitialized(): Promise<boolean> {
    logger.info('Checking if Servarr has initialized database tables...')

    try {
      const db = this.createDatabaseConnection()
      const tables = await db`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name IN ('Users', 'Config', 'RootFolders', 'Indexers')
      `
      db.close()

      const tableNames = tables.map((t: { table_name: string }) => t.table_name)
      const requiredTables = ['Users', 'Config']
      const hasRequiredTables = requiredTables.every((table) => tableNames.includes(table))

      logger.info('Database table check completed', {
        hasRequiredTables,
        foundTables: tableNames.length,
        requiredTables,
      })

      logger.debug('About to close database connection in checkServarrTablesInitialized')
      db.close()
      logger.debug('Database connection closed in checkServarrTablesInitialized')

      return hasRequiredTables
    } catch (error) {
      logger.error('Failed to check database tables', { error })
      return false
    }
  }

  async createInitialUser(): Promise<void> {
    if (!this.config.adminPassword) {
      logger.debug('Skipping user creation - no admin password configured')
      return
    }

    logger.info('Creating initial admin user...', {
      username: this.config.adminUser,
    })

    try {
      const db = this.createDatabaseConnection()

      try {
        // Get all users from database to check for duplicates
        const scheme = this.credentialScheme

        // Literal per scheme: selecting a column the table does not have fails
        // the whole statement, and these are identifiers rather than values so
        // they cannot be bound as parameters.
        let allUsers = (
          scheme === 'sha256'
            ? await db`SELECT "Id", "Identifier", "Username", "Password" FROM "Users"`
            : await db`SELECT "Id", "Identifier", "Username", "Password", "Salt", "Iterations" FROM "Users"`
        ) as DatabaseUser[]
        const normalizedAdminUser = this.config.adminUser.toLowerCase()

        // Check if the desired admin user already exists
        let existingUser = allUsers.find(
          (user) => user.Username.toLowerCase() === normalizedAdminUser,
        )

        if (!existingUser && allUsers.length > 0) {
          const userToRename =
            allUsers.find((user) => user.Username.toLowerCase() === 'admin') ?? allUsers[0]

          if (!userToRename) {
            throw new Error('Unable to select user for renaming')
          }

          await db`
            UPDATE "Users"
            SET "Username" = ${normalizedAdminUser}
            WHERE "Id" = ${userToRename.Id}
          `

          logger.info('Renamed existing admin user to match desired username', {
            previousUsername: userToRename.Username,
            newUsername: this.config.adminUser,
          })

          const renamedUser: DatabaseUser = {
            ...userToRename,
            Username: normalizedAdminUser,
          }
          existingUser = renamedUser
          allUsers = allUsers.map((user) => (user.Id === userToRename.Id ? renamedUser : user))
        }

        if (!existingUser) {
          // Create new user
          const userId = crypto.randomUUID()
          const salt = newSalt(scheme)
          const hashedPassword = await hashPassword(scheme, this.config.adminPassword, salt)

          if (salt) {
            await db`
              INSERT INTO "Users" ("Identifier", "Username", "Password", "Salt", "Iterations")
              VALUES (${userId}, ${normalizedAdminUser}, ${hashedPassword}, ${Buffer.from(salt).toString('base64')}, 10000)
            `
          } else {
            await db`
              INSERT INTO "Users" ("Identifier", "Username", "Password")
              VALUES (${userId}, ${normalizedAdminUser}, ${hashedPassword})
            `
          }

          logger.info('Initial admin user created successfully', {
            username: this.config.adminUser,
            userId,
          })
        } else {
          // User exists - check if password needs updating
          if (!(await passwordMatches(scheme, this.config.adminPassword, existingUser))) {
            await this.updateUserPassword(db, this.config.adminUser, this.config.adminPassword)
            logger.info('Admin user password updated successfully', {
              username: this.config.adminUser,
            })
          } else {
            logger.info('Admin user already exists', { username: this.config.adminUser })
          }
        }

        // Fix for "Sequence contains more than one element" error:
        // Ensure only one admin user exists to prevent Prowlarr authentication issues
        if (allUsers.length > 1) {
          for (const user of allUsers) {
            if (user.Username.toLowerCase() !== this.config.adminUser.toLowerCase()) {
              await db`DELETE FROM "Users" WHERE "Id" = ${user.Id}`
              logger.info('Duplicate admin user removed', {
                username: user.Username,
                reason: 'Preventing multiple user conflicts',
              })
            }
          }
        }
      } finally {
        db.close()
      }
    } catch (error) {
      logger.error('Failed to create initial user', { error })
      throw error
    }
  }

  async updateUserPassword(db: SQL, username: string, password: string): Promise<void> {
    const scheme = this.credentialScheme
    const salt = newSalt(scheme)
    const hashedPassword = await hashPassword(scheme, password, salt)

    if (salt) {
      await db`
        UPDATE "Users"
        SET "Password" = ${hashedPassword}, "Salt" = ${Buffer.from(salt).toString('base64')}, "Iterations" = 10000
        WHERE LOWER("Username") = LOWER(${username})
      `
    } else {
      await db`
        UPDATE "Users"
        SET "Password" = ${hashedPassword}
        WHERE LOWER("Username") = LOWER(${username})
      `
    }
  }

  async createInitialUserInInitMode(): Promise<void> {
    logger.info('Creating initial admin user in init mode...', {
      username: this.config.adminUser,
    })

    try {
      const db = this.createDatabaseConnection()

      const existingUsers =
        await db`SELECT * FROM "Users" WHERE LOWER("Username") = LOWER(${this.config.adminUser})`

      if (existingUsers.length > 0) {
        logger.info('Admin user already exists', { username: this.config.adminUser })
        logger.debug('Closing database connection after user check')
        try {
          db.close()
          logger.debug('Database connection closed successfully')
        } catch (closeError) {
          logger.warn('Error closing database connection', { closeError })
        }
        logger.debug('Returning from createInitialUserInInitMode')
        return
      }

      const userId = crypto.randomUUID()
      const scheme = this.credentialScheme
      const salt = newSalt(scheme)
      const hashedPassword = await hashPassword(scheme, this.config.adminPassword ?? '', salt)
      const username = this.config.adminUser.toLowerCase()

      if (salt) {
        await db`
          INSERT INTO "Users" ("Identifier", "Username", "Password", "Salt", "Iterations")
          VALUES (${userId}, ${username}, ${hashedPassword}, ${Buffer.from(salt).toString('base64')}, 10000)
        `
      } else {
        await db`
          INSERT INTO "Users" ("Identifier", "Username", "Password")
          VALUES (${userId}, ${username}, ${hashedPassword})
        `
      }

      db.close()

      logger.info('Initial admin user created successfully in init mode', {
        username: this.config.adminUser,
        userId,
      })
    } catch (error) {
      logger.error('Failed to create initial user in init mode', { error })
      throw error
    }
  }

  async configureDatabase(
    postgresConfig: PostgresConfig,
    client: ServarrClientType | null,
    apiKey: string | null,
  ): Promise<void> {
    if (!apiKey) {
      throw new Error('ServarrManager must be initialized before configuring database')
    }

    logger.info('Configuring Servarr database connection...')
    const databases = this.getDatabaseNames()

    const dbConfig: Record<string, string | number> = {
      databaseType: 'postgresql',
      host: postgresConfig.host,
      port: postgresConfig.port,
      database: databases.main,
      user: this.config.type,
      password: postgresConfig.password,
    }

    if (databases.log) {
      dbConfig.logDatabase = databases.log
    }

    try {
      if (!client || !('updateHostConfig' in client)) {
        logger.debug('updateHostConfig not supported for this Servarr type')
        throw new Error('Database configuration not supported for this Servarr type')
      }

      const typedClient = client as ServarrClientType & ClientWithHostConfig
      const result = await typedClient.updateHostConfig(1, dbConfig)

      if (result.error) {
        const errorMessage =
          result.error instanceof Error
            ? result.error.message
            : typeof result.error === 'string'
              ? result.error
              : JSON.stringify(result.error)
        throw new Error(`API error: ${errorMessage}`)
      }

      logger.info('Database configuration updated')

      await this.restartServarr(client)
    } catch (error) {
      logger.error('Failed to configure database', { error })
      throw error
    }
  }

  async restartServarr(client: ServarrClientType | null): Promise<void> {
    logger.info('Restarting Servarr to apply database configuration...')

    try {
      await client?.restartSystem()

      await new Promise((resolve) => setTimeout(resolve, 5000))

      logger.info('Servarr restart command sent')
    } catch (error) {
      logger.error('Failed to restart Servarr', { error })
      throw error
    }
  }
}
