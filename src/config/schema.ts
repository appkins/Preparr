import { z } from 'zod'

export const PostgresConfigSchema = z.object({
  host: z.string().default('localhost'),
  port: z
    .union([z.number(), z.string()])
    .transform((val) => {
      if (typeof val === 'number') return Number.isNaN(val) ? undefined : val
      const parsed = Number.parseInt(val, 10)
      return Number.isNaN(parsed) ? undefined : parsed
    })
    .pipe(z.number().optional())
    .default(5432),
  username: z.string().default('postgres'),
  password: z.string(),
  database: z.string().default('servarr'),
  logDatabaseEnabled: z.boolean().default(true),
  skipProvisioning: z.boolean().default(false),
})

export const ServarrConfigSchema = z
  .object({
    url: z.string().optional(),
    type: z
      .enum([
        'sonarr',
        'radarr',
        'lidarr',
        'readarr',
        'prowlarr',
        'qbittorrent',
        'bazarr',
        'sabnzbd',
        'auto',
      ])
      .default('auto'),
    apiKey: z
      .string()
      .length(32, 'API key must be exactly 32 characters')
      .regex(/^[a-f0-9]+$/, 'API key must be hexadecimal')
      .optional(),
    adminUser: z.string().default('admin'),
    adminPassword: z.string().optional(),
    authenticationMethod: z.enum(['basic', 'forms']).default('forms'),
  })
  .refine(
    (data) => {
      // servarr.url addresses a Servarr API. qBittorrent, Bazarr and SABnzbd
      // are not Servarr apps and are reached through their own services.*
      // entry, so none of them has one to give.
      if (data.type !== 'qbittorrent' && data.type !== 'bazarr' && data.type !== 'sabnzbd') {
        if (!data.url) {
          return false
        }
        // Validate URL format for non-qbittorrent/bazarr types
        try {
          new URL(data.url)
        } catch {
          return false
        }
      }
      return true
    },
    {
      message: 'Valid URL is required when type is not qbittorrent or bazarr',
      path: ['url'],
    },
  )
  .refine(
    (data) => {
      // adminPassword validation: required for Servarr types, optional for qbittorrent and bazarr
      if (data.type !== 'qbittorrent' && data.type !== 'bazarr' && data.type !== 'sabnzbd') {
        if (!data.adminPassword) {
          return false
        }
      }
      return true
    },
    {
      message: 'Admin password is required when type is not qbittorrent, bazarr or sabnzbd',
      path: ['adminPassword'],
    },
  )

export const BazarrLanguageSchema = z.object({
  code: z.string(),
  name: z.string(),
  enabled: z.boolean().default(true),
})

export const BazarrProviderSchema = z.object({
  name: z.string(),
  enabled: z.boolean().default(true),
  settings: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
})

export const BazarrSubtitleDefaultsSchema = z.object({
  seriesType: z.string().default('hearing_impaired_preferred'),
  movieType: z.string().default('hearing_impaired_preferred'),
  searchOnUpgrade: z.boolean().default(true),
  searchOnDownload: z.boolean().default(true),
})

export const BazarrLanguageProfileItemSchema = z.object({
  language: z.string(),
  forced: z.boolean().default(false),
  hi: z.boolean().default(false),
  audio_exclude: z.boolean().default(false),
  audio_only_include: z.boolean().default(false),
})

export const BazarrLanguageProfileSchema = z.object({
  name: z.string(),
  cutoff: z.number().nullable().optional(),
  items: z.array(BazarrLanguageProfileItemSchema).min(1),
  mustContain: z.string().default(''),
  mustNotContain: z.string().default(''),
  originalFormat: z.boolean().nullable().optional(),
  tag: z.string().nullable().optional(),
  default: z.boolean().default(false),
  applyToExisting: z.boolean().default(false),
})

export const BazarrDefaultProfilesSchema = z.object({
  series: z.string().optional(),
  movies: z.string().optional(),
})

export const BazarrConfigSchema = z
  .object({
    sonarr: z
      .object({
        url: z.url(),
        apiKey: z.string(),
      })
      .optional(),
    radarr: z
      .object({
        url: z.url(),
        apiKey: z.string(),
      })
      .optional(),
    languages: z.array(BazarrLanguageSchema).default([]),
    languageProfiles: z.array(BazarrLanguageProfileSchema).default([]),
    defaultProfiles: BazarrDefaultProfilesSchema.optional(),
    providers: z.array(BazarrProviderSchema).default([]),
    subtitleDefaults: BazarrSubtitleDefaultsSchema.optional(),
  })
  .optional()

export const ServiceIntegrationSchema = z.object({
  qbittorrent: z
    .object({
      url: z.url(),
      username: z.string(),
      password: z.string(),
    })
    .optional(),
  // Unlike qBittorrent there is no login handshake: every SABnzbd request
  // carries the API key, so there is no username/password pair here.
  sabnzbd: z
    .object({
      url: z.url(),
      apiKey: z.string().optional(),
    })
    .optional(),
  prowlarr: z
    .object({
      url: z.url(),
      apiKey: z.string().optional(),
    })
    .optional(),
  bazarr: z
    .object({
      url: z.url(),
      apiKey: z.string().optional(),
    })
    .optional(),
})

export const RootFolderSchema = z.object({
  path: z.string(),
  accessible: z.boolean().default(true),
  freeSpace: z.number().optional(),
  unmappedFolders: z.array(z.string()).default([]),

  // Readarr and Lidarr require these three; the rest of the family has no
  // field for them. Left unset, the name is derived from the path and the
  // profiles fall back to whatever the instance already has.
  name: z.string().optional(),
  defaultQualityProfileId: z.number().optional(),
  defaultMetadataProfileId: z.number().optional(),
})

// Custom Format Specification Schema
export const CustomFormatSpecificationSchema = z.object({
  name: z.string(),
  implementation: z.string(),
  negate: z.boolean().default(false),
  required: z.boolean().default(false),
  fields: z
    .array(
      z.object({
        name: z.string(),
        value: z.union([z.string(), z.number(), z.boolean(), z.array(z.number())]),
      }),
    )
    .default([]),
})

// Custom Format Schema (Radarr/Sonarr v4+)
export const CustomFormatSchema = z.object({
  id: z.number().optional(),
  name: z.string(),
  includeCustomFormatWhenRenaming: z.boolean().default(false),
  specifications: z.array(CustomFormatSpecificationSchema).default([]),
})

// Format Item for Quality Profile integration
export const FormatItemSchema = z.object({
  format: z.string(), // Reference by name (resolved to ID at runtime)
  score: z.number(),
})

export const QualityProfileSchema = z.object({
  name: z.string(),
  cutoff: z.number(),
  items: z.array(
    z.object({
      quality: z.object({
        id: z.number(),
        name: z.string(),
      }),
      allowed: z.boolean(),
    }),
  ),
  // Custom Format integration
  formatItems: z.array(FormatItemSchema).default([]),
  minFormatScore: z.number().default(0),
  cutoffFormatScore: z.number().default(0),
  upgradeAllowed: z.boolean().default(true),
})

// Release Profile Schema (Sonarr only)
export const ReleaseProfileTermSchema = z.object({
  key: z.string(), // The term or regex pattern
  value: z.number(), // Score
})

export const ReleaseProfileSchema = z.object({
  id: z.number().optional(),
  name: z.string(),
  enabled: z.boolean().default(true),
  required: z.string().nullable().default(null), // Comma-separated or null
  ignored: z.string().nullable().default(null), // Comma-separated or null
  preferred: z.array(ReleaseProfileTermSchema).default([]),
  includePreferredWhenRenaming: z.boolean().default(false),
  indexerId: z.number().default(0), // 0 = all indexers
  tags: z.array(z.number()).default([]),
})

// Naming Configuration Schema
export const NamingConfigSchema = z.object({
  // Sonarr fields
  renameEpisodes: z.boolean().optional(),
  standardEpisodeFormat: z.string().optional(),
  dailyEpisodeFormat: z.string().optional(),
  animeEpisodeFormat: z.string().optional(),
  seriesFolderFormat: z.string().optional(),
  seasonFolderFormat: z.string().optional(),
  specialsFolderFormat: z.string().optional(),
  multiEpisodeStyle: z.number().optional(), // 0-5
  // Radarr fields
  renameMovies: z.boolean().optional(),
  movieFormat: z.string().optional(),
  movieFolderFormat: z.string().optional(),
  colonReplacementFormat: z.number().optional(),
  // Lidarr fields
  renameTracks: z.boolean().optional(),
  trackFormat: z.string().optional(),
  artistFolderFormat: z.string().optional(),
  albumFolderFormat: z.string().optional(),
  // Readarr fields
  renameBooks: z.boolean().optional(),
  standardBookFormat: z.string().optional(),
  authorFolderFormat: z.string().optional(),
  // Common
  replaceIllegalCharacters: z.boolean().default(true),
})

// Media Management Configuration Schema
export const MediaManagementConfigSchema = z.object({
  // File handling
  importExtraFiles: z.boolean().default(false),
  extraFileExtensions: z.string().default('srt,sub,idx'),
  // Permissions
  setPermissionsLinux: z.boolean().default(false),
  chmodFolder: z.string().default('755'),
  chmodFile: z.string().default('644'),
  chownGroup: z.string().optional(),
  // Download handling
  autoUnmonitorPreviouslyDownloaded: z.boolean().default(false),
  downloadPropersAndRepacks: z.string().default('preferAndUpgrade'), // 'preferAndUpgrade' | 'doNotUpgrade' | 'doNotPrefer'
  createEmptySeriesFolders: z.boolean().optional(), // Sonarr
  createEmptyMovieFolders: z.boolean().optional(), // Radarr
  deleteEmptyFolders: z.boolean().default(false),
  // File management
  fileDate: z.string().default('none'), // 'none' | 'localAirDate' | 'utcAirDate'
  recycleBin: z.string().optional(),
  recycleBinCleanupDays: z.number().default(7),
  // Hardlinks/Copy
  skipFreeSpaceCheckWhenImporting: z.boolean().default(false),
  minimumFreeSpaceWhenImporting: z.number().default(100), // MB
  copyUsingHardlinks: z.boolean().default(true),
  useScriptImport: z.boolean().default(false),
  scriptImportPath: z.string().optional(),
  // Analysis
  enableMediaInfo: z.boolean().default(true),
  rescanAfterRefresh: z.string().default('always'), // 'always' | 'afterManual' | 'never'
})

// Quality Definition Schema
export const QualityDefinitionSchema = z.object({
  quality: z.string(), // Quality name like "Bluray-1080p"
  title: z.string().optional(), // Display title
  minSize: z.number().min(0).optional(), // MB per minute
  maxSize: z.number().min(0).optional(), // MB per minute (null = unlimited)
  preferredSize: z.number().min(0).optional(), // MB per minute
})

export const IndexerSchema = z.object({
  name: z.string(),
  implementation: z.string(),
  implementationName: z.string(),
  configContract: z.string(),
  infoLink: z.string().nullable().optional(),
  tags: z.array(z.number()).default([]),
  fields: z.array(
    z.object({
      name: z.string(),
      value: z.union([z.string(), z.number(), z.boolean(), z.array(z.number())]),
    }),
  ),
  enable: z.boolean().default(true),
  priority: z.number().default(25),
  appProfileId: z.number().optional(),

  // Prowlarr requires this true for Usenet indexers and rejects the create
  // otherwise. Left unset it is derived from the implementation, so only an
  // indexer that wants to contradict that needs to say so.
  redirect: z.boolean().optional(),
})

export const DownloadClientSchema = z.object({
  name: z.string(),
  implementation: z.string(),
  implementationName: z.string(),
  configContract: z.string(),
  fields: z.array(
    z.object({
      name: z.string(),
      value: z.union([z.string(), z.number(), z.boolean(), z.array(z.number())]),
    }),
  ),
  enable: z.boolean().default(true),
  priority: z.number().default(1),
})

export const QBittorrentConfigSchema = z
  .object({
    webui: z
      .object({
        username: z.string().default('admin'),
        password: z.string().default('adminpass'),
      })
      .optional(),
    downloads: z
      .object({
        defaultPath: z.string().default('/downloads'),
        categories: z.array(z.string()).default([]),
      })
      .optional(),
    connection: z
      .object({
        port: z.number().default(6881),
      })
      .optional(),
  })
  .optional()

/**
 * A SABnzbd category. `dir` is resolved relative to the completed directory,
 * so "tv" lands at <completePath>/tv.
 */
export const SabnzbdCategorySchema = z.object({
  name: z.string(),
  dir: z.string().default(''),
  // SABnzbd's "Low" priority, matching what its own defaults use for the
  // per-media-type categories.
  priority: z.number().default(-100),
  script: z.string().default('Default'),
  pp: z.string().optional(),
})

/**
 * A Usenet server. SABnzbd cannot download at all without one, and it is the
 * one part of its configuration with no default worth guessing.
 */
export const SabnzbdServerSchema = z.object({
  name: z.string().optional(),
  host: z.string(),
  port: z.number().default(563),
  username: z.string().optional(),
  password: z.string().optional(),
  connections: z.number().default(8),
  ssl: z.boolean().default(true),
  enable: z.boolean().default(true),
  priority: z.number().default(0),
  retention: z.number().optional(),
})

export const SabnzbdConfigSchema = z
  .object({
    downloads: z
      .object({
        // Relative paths resolve under SABnzbd's own config directory, which
        // is rarely where the media volume is mounted, so both are explicit.
        completePath: z.string().default('/downloads/complete'),
        incompletePath: z.string().default('/downloads/incomplete'),
      })
      .optional(),
    categories: z.array(SabnzbdCategorySchema).default([]),
    servers: z.array(SabnzbdServerSchema).default([]),
  })
  .optional()

export const ApplicationSchema = z.object({
  id: z.number().optional(),
  name: z.string(),
  implementation: z.string(),
  implementationName: z.string(),
  configContract: z.string(),
  appProfileId: z.number().optional(),
  fields: z.array(
    z.object({
      name: z.string(),
      value: z.union([z.string(), z.number(), z.boolean(), z.array(z.number())]),
    }),
  ),
  enable: z.boolean().default(true),
  syncLevel: z.string().default('addOnly'),
  tags: z.array(z.number()).default([]),
})

/**
 * A Prowlarr indexer proxy (FlareSolverr, HTTP, SOCKS).
 *
 * `tags` are labels rather than ids: Prowlarr assigns tag ids itself and
 * rejects a POST that carries a chosen one, so an id cannot be pinned from
 * configuration. The labels are resolved against the live instance when the
 * proxy is applied.
 */
export const IndexerProxySchema = z
  .object({
    id: z.number().optional(),
    name: z.string(),
    implementation: z.string(),
    implementationName: z.string().optional(),
    configContract: z.string(),
    fields: z
      .array(
        z.object({
          name: z.string(),
          value: z.union([z.string(), z.number(), z.boolean()]),
        }),
      )
      .default([]),
    tags: z.array(z.string()).default([]),
  })
  // Prowlarr wants both implementation and implementationName and they are the
  // same string for every built-in proxy; zod cannot default one from a
  // sibling, so it is filled in here.
  .transform((proxy) => ({
    ...proxy,
    implementationName: proxy.implementationName ?? proxy.implementation,
  }))

export const AppConfigSchema = z.object({
  apiKey: z.string().optional(),
  prowlarrSync: z.boolean().default(false),
  rootFolders: z.array(RootFolderSchema).default([]),
  qualityProfiles: z.array(QualityProfileSchema).default([]),
  indexers: z.array(IndexerSchema).optional(),
  downloadClients: z.array(DownloadClientSchema).default([]),
  applications: z.array(ApplicationSchema).default([]),
  qbittorrent: QBittorrentConfigSchema,
  sabnzbd: SabnzbdConfigSchema,

  // Tag labels to ensure exist. Anything referenced by an indexer proxy or by
  // indexerTags is created whether or not it is also listed here.
  tags: z.array(z.string()).default([]),
  indexerProxies: z.array(IndexerProxySchema).default([]),

  // Indexer name => tag labels it should carry. Kept separate from the
  // indexer definitions because IndexersStep matches on name only and has no
  // update path, so an existing indexer would never be retagged otherwise.
  indexerTags: z.record(z.string(), z.array(z.string())).default({}),
  // Custom Formats (Radarr/Sonarr v4+)
  customFormats: z.array(CustomFormatSchema).default([]),
  // Release Profiles (Sonarr only)
  releaseProfiles: z.array(ReleaseProfileSchema).default([]),
  // Naming Configuration
  naming: NamingConfigSchema.optional(),
  // Media Management
  mediaManagement: MediaManagementConfigSchema.optional(),
  // Quality Definitions (size limits)
  qualityDefinitions: z.array(QualityDefinitionSchema).default([]),
  bazarr: BazarrConfigSchema,
})

export const ConfigSchema = z.object({
  postgres: PostgresConfigSchema,
  servarr: ServarrConfigSchema,
  services: ServiceIntegrationSchema.optional(),
  // Unified application desired-state config
  app: AppConfigSchema.default({
    prowlarrSync: false,
    rootFolders: [],
    qualityProfiles: [],
    downloadClients: [],
    applications: [],
    customFormats: [],
    releaseProfiles: [],
    qualityDefinitions: [],
    tags: [],
    indexerProxies: [],
    indexerTags: {},
  }),
  health: z
    .object({
      port: z.coerce.number().default(8080),
    })
    .default({ port: 8080 }),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  logFormat: z.enum(['json', 'pretty']).default('json'),
  configPath: z.string().default('/config/servarr.yaml'),
  configWatch: z.boolean().default(true),
  configReconcileInterval: z.coerce.number().default(60),
})

export type PostgresConfig = z.infer<typeof PostgresConfigSchema>
export type ServarrConfig = z.infer<typeof ServarrConfigSchema>
export type ServiceIntegration = z.infer<typeof ServiceIntegrationSchema>
export type SabnzbdConfig = z.infer<typeof SabnzbdConfigSchema>
export type SabnzbdCategory = z.infer<typeof SabnzbdCategorySchema>
export type SabnzbdServer = z.infer<typeof SabnzbdServerSchema>
export type IndexerProxy = z.infer<typeof IndexerProxySchema>
export type RootFolder = z.infer<typeof RootFolderSchema>
export type CustomFormatSpecification = z.infer<typeof CustomFormatSpecificationSchema>
export type CustomFormat = z.infer<typeof CustomFormatSchema>
export type FormatItem = z.infer<typeof FormatItemSchema>
export type QualityProfile = z.infer<typeof QualityProfileSchema>
export type ReleaseProfileTerm = z.infer<typeof ReleaseProfileTermSchema>
export type ReleaseProfile = z.infer<typeof ReleaseProfileSchema>
export type NamingConfig = z.infer<typeof NamingConfigSchema>
export type MediaManagementConfig = z.infer<typeof MediaManagementConfigSchema>
export type QualityDefinition = z.infer<typeof QualityDefinitionSchema>
export type Indexer = z.infer<typeof IndexerSchema>
export type DownloadClient = z.infer<typeof DownloadClientSchema>
export type Application = z.infer<typeof ApplicationSchema>
export type QBittorrentConfig = z.infer<typeof QBittorrentConfigSchema>
export type BazarrLanguage = z.infer<typeof BazarrLanguageSchema>
export type BazarrProvider = z.infer<typeof BazarrProviderSchema>
export type BazarrSubtitleDefaults = z.infer<typeof BazarrSubtitleDefaultsSchema>
export type BazarrLanguageProfileItem = z.infer<typeof BazarrLanguageProfileItemSchema>
export type BazarrLanguageProfile = z.infer<typeof BazarrLanguageProfileSchema>
export type BazarrDefaultProfiles = z.infer<typeof BazarrDefaultProfilesSchema>
export type BazarrConfig = z.infer<typeof BazarrConfigSchema>
export type AppConfig = z.infer<typeof AppConfigSchema>
export type Config = z.infer<typeof ConfigSchema>
