import { describe, expect, test } from 'bun:test'
import { AppConfigSchema, ConfigSchema, ServarrConfigSchema } from './schema'

describe('Configuration Schema Validation', () => {
  test('validates valid servarr application config', () => {
    const validConfig = {
      apiKey: 'abcd1234567890abcd1234567890abcd',
      rootFolders: [{ path: '/tv', accessible: true, unmappedFolders: [] }],
      indexers: [],
      downloadClients: [
        {
          name: 'qBittorrent',
          implementation: 'QBittorrent',
          implementationName: 'qBittorrent',
          configContract: 'QBittorrentSettings',
          fields: [
            { name: 'host', value: 'qbittorrent' },
            { name: 'port', value: 8080 },
          ],
        },
      ],
      qualityProfiles: [],
      applications: [],
    }

    const result = AppConfigSchema.safeParse(validConfig)
    expect(result.success).toBe(true)
  })

  test('validates servarr config with different types', () => {
    const configs = [
      { type: 'sonarr', url: 'http://sonarr:8989', adminPassword: 'pass' },
      { type: 'radarr', url: 'http://radarr:7878', adminPassword: 'pass' },
      { type: 'prowlarr', url: 'http://prowlarr:9696', adminPassword: 'pass' },
      { type: 'qbittorrent', adminPassword: 'pass' }, // No URL required for qbittorrent
      { type: 'tdarr' }, // Reached through services.tdarr; no Servarr URL or admin user
    ]

    for (const config of configs) {
      const result = ServarrConfigSchema.safeParse(config)
      expect(result.success).toBe(true)
    }
  })

  test('rejects invalid servarr config', () => {
    const invalidConfigs = [
      { type: 'sonarr', adminPassword: 'pass' }, // Missing required URL
      { type: 'invalid', url: 'http://test', adminPassword: 'pass' }, // Invalid type
      { type: 'sonarr', url: 'not-a-url', adminPassword: 'pass' }, // Invalid URL
      { type: 'sonarr', url: 'http://sonarr:8989', apiKey: 'short' }, // Invalid API key
    ]

    for (const config of invalidConfigs) {
      const result = ServarrConfigSchema.safeParse(config)
      expect(result.success).toBe(false)
    }
  })

  test('validates complete environment config', () => {
    const validEnvConfig = {
      postgres: {
        host: 'postgres',
        port: 5432,
        username: 'postgres',
        password: 'secret',
        database: 'servarr',
      },
      servarr: {
        type: 'sonarr',
        url: 'http://sonarr:8989',
        adminPassword: 'password',
      },
      health: {
        port: 8080,
      },
      logLevel: 'info',
      configPath: '/config/servarr.yaml',
      configWatch: true,
      configReconcileInterval: 60,
    }

    const result = ConfigSchema.safeParse(validEnvConfig)
    expect(result.success).toBe(true)

    if (result.success) {
      expect(result.data.health.port).toBe(8080)
      expect(result.data.logLevel).toBe('info')
      expect(result.data.configReconcileInterval).toBe(60)
    }
  })

  test('applies default values correctly', () => {
    const minimalConfig = {
      postgres: {
        password: 'secret',
      },
      servarr: {
        type: 'sonarr',
        url: 'http://sonarr:8989',
        adminPassword: 'password',
      },
    }

    const result = ConfigSchema.safeParse(minimalConfig)
    expect(result.success).toBe(true)

    if (result.success) {
      expect(result.data.postgres.host).toBe('localhost') // Default
      expect(result.data.postgres.port).toBe(5432) // Default
      expect(result.data.postgres.logDatabaseEnabled).toBe(true) // Default
      expect(result.data.health.port).toBe(8080) // Default
      expect(result.data.logLevel).toBe('info') // Default
      expect(result.data.configWatch).toBe(true) // Default
      expect(result.data.servarr.authenticationMethod).toBe('forms') // Default
    }
  })
})

describe('naming config field names match the Servarr APIs', () => {
  test('a Radarr movie file format survives parsing under the name Radarr uses', () => {
    // Radarr's /config/naming resource calls this field standardMovieFormat.
    // A schema that spells it differently does not fail -- zod strips unknown
    // keys -- so the format is silently dropped on the way in and the PUT that
    // follows carries nothing Radarr recognises. Nothing logs and nothing
    // changes; the folder names simply stay as they were.
    const format = '{Movie CleanTitle} {(Release Year)} {tmdb-{TmdbId}}'

    const result = AppConfigSchema.safeParse({ naming: { standardMovieFormat: format } })

    expect(result.success).toBe(true)
    expect(result.data?.naming?.standardMovieFormat).toBe(format)
  })

  test('the Sonarr equivalent is already named correctly', () => {
    const format = '{Series CleanTitleWithoutYear} {(Series Year)} {tvdb-{TvdbId}}'

    const result = AppConfigSchema.safeParse({ naming: { seriesFolderFormat: format } })

    expect(result.data?.naming?.seriesFolderFormat).toBe(format)
  })
})

describe('tdarr configuration', () => {
  test('an exported flow file parses as a flow, id and all', async () => {
    const { TdarrConfigSchema } = await import('./schema')
    const parsed = TdarrConfigSchema.parse({
      flows: [
        {
          _id: 'hevc10Bit',
          name: 'HEVC 10-bit',
          priority: 1,
          flowPlugins: [{ id: 'input', pluginName: 'inputFile', inputsDB: {} }],
          flowEdges: [{ id: 'e', source: 'input', sourceHandle: '1', target: 'x' }],
          isUiLocked: false,
        },
      ],
      libraries: [
        { name: 'Movies', folder: '/data/movies', flow: 'HEVC 10-bit', scannerThreadCount: 4 },
      ],
      nodes: [{ name: 'gpu', workerLimits: { transcodegpu: 1 } }],
    })

    expect(parsed.flows[0]?._id).toBe('hevc10Bit')
    expect(parsed.flows[0]?.isUiLocked).toBe(false)
    expect(parsed.libraries[0]?.variables).toEqual({})
    expect((parsed.libraries[0] as Record<string, unknown>).scannerThreadCount).toBe(4)
    expect(parsed.nodes[0]?.workerLimits?.transcodegpu).toBe(1)
    expect(parsed.settings).toEqual({})
  })

  test('a node with a negative worker count is rejected', async () => {
    const { TdarrNodeSchema } = await import('./schema')
    expect(
      TdarrNodeSchema.safeParse({ name: 'x', workerLimits: { transcodecpu: -1 } }).success,
    ).toBe(false)
  })
})
