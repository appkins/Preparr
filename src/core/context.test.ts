import { describe, expect, test } from 'bun:test'
import type { Config } from '@/config/schema'
import { ContextBuilder } from './context'

describe('ContextBuilder', () => {
  test('builds qbittorrent-only execution contexts', () => {
    const config: Config = {
      postgres: {
        host: 'localhost',
        port: 5432,
        username: 'postgres',
        password: '',
        database: 'servarr',
        logDatabaseEnabled: true,
        skipProvisioning: false,
      },
      servarr: {
        type: 'qbittorrent',
        adminUser: 'admin',
        authenticationMethod: 'forms',
      },
      services: {
        qbittorrent: {
          url: 'http://qbittorrent:8080',
          username: 'admin',
          password: 'adminpass',
        },
      },
      app: {
        prowlarrSync: false,
        rootFolders: [],
        qualityProfiles: [],
        downloadClients: [],
        applications: [],
        customFormats: [],
        releaseProfiles: [],
        qualityDefinitions: [],
      },
      health: {
        port: 8080,
      },
      logLevel: 'info',
      logFormat: 'json',
      configPath: '/config/qbittorrent.json',
      configWatch: true,
      configReconcileInterval: 60,
    }
    const context = new ContextBuilder()
      .setConfig(config)
      .setServarrType('qbittorrent')
      .setPostgresClient({} as unknown as import('@/postgres/client').PostgresClient)
      .setQBittorrentClient({} as unknown as import('@/qbittorrent/client').QBittorrentManager)
      .setExecutionMode('init')
      .build()

    expect(context.servarrType).toBe('qbittorrent')
    expect(context.qbittorrentClient).toBeDefined()
  })

  test('accepts a lazylibrarian client as the only service client, in init mode', () => {
    // An init run for LazyLibrarian only writes a configuration file and calls
    // nothing, but the context still insists on a client existing -- so one
    // has to be built in both modes or the run is refused before it can write.
    const config = {
      postgres: {
        host: 'localhost',
        port: 5432,
        username: 'postgres',
        password: '',
        database: 'servarr',
        logDatabaseEnabled: false,
        skipProvisioning: true,
      },
      servarr: { type: 'lazylibrarian', adminUser: 'admin', authenticationMethod: 'forms' },
      services: { lazylibrarian: { url: 'http://localhost:5299', apiKey: 'k' } },
      app: {
        prowlarrSync: false,
        rootFolders: [],
        qualityProfiles: [],
        downloadClients: [],
        applications: [],
        customFormats: [],
        releaseProfiles: [],
        qualityDefinitions: [],
      },
      health: { port: 8080 },
      logLevel: 'info',
      logFormat: 'json',
      configPath: '/preparr/lazylibrarian-config.json',
      configWatch: true,
      configReconcileInterval: 60,
      // biome-ignore lint/suspicious/noExplicitAny: a Config stub, not a Config
    } as any

    const context = new ContextBuilder()
      .setConfig(config)
      .setServarrType('lazylibrarian')
      .setPostgresClient({} as unknown as import('@/postgres/client').PostgresClient)
      .setLazyLibrarianClient({} as unknown as import('@/lazylibrarian/client').LazyLibrarianClient)
      .setExecutionMode('init')
      .build()

    expect(context.lazyLibrarianClient).toBeDefined()
    expect(context.executionMode).toBe('init')
  })

  test('accepts a sabnzbd client as the only service client', () => {
    const config = {
      postgres: {
        host: 'localhost',
        port: 5432,
        username: 'postgres',
        password: 'x',
        database: 'sabnzbd',
        logDatabaseEnabled: false,
        skipProvisioning: true,
      },
      servarr: {
        type: 'sabnzbd',
        adminUser: 'admin',
        authenticationMethod: 'forms',
      },
      app: {
        prowlarrSync: false,
        rootFolders: [],
        qualityProfiles: [],
        downloadClients: [],
        applications: [],
        customFormats: [],
        releaseProfiles: [],
        qualityDefinitions: [],
      },
      health: { port: 8080 },
      logLevel: 'info',
      logFormat: 'json',
      configPath: '/config/sabnzbd.json',
      configWatch: true,
      configReconcileInterval: 60,
    } as unknown as import('@/config/schema').Config

    const context = new ContextBuilder()
      .setConfig(config)
      .setServarrType('sabnzbd')
      .setPostgresClient({} as unknown as import('@/postgres/client').PostgresClient)
      .setSabnzbdClient({} as unknown as import('@/sabnzbd/client').SabnzbdManager)
      .setExecutionMode('sidecar')
      .build()

    expect(context.sabnzbdClient).toBeDefined()
  })
})
