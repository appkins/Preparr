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
