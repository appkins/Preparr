import type { BazarrManager } from '@/bazarr/client'
import type { Config } from '@/config/schema'
import type { LazyLibrarianClient } from '@/lazylibrarian/client'
import type { PostgresClient } from '@/postgres/client'
import type { ProwlarrExtrasClient } from '@/prowlarr/client'
import type { QBittorrentManager } from '@/qbittorrent/client'
import type { SabnzbdManager } from '@/sabnzbd/client'
import type { ServarrManager } from '@/servarr/client'
import type { StepContext } from './step'

export class ContextBuilder {
  private context: Partial<StepContext> = {}

  setConfig(config: Config): this {
    this.context.config = config
    return this
  }

  setServarrType(type: string): this {
    this.context.servarrType = type
    return this
  }

  setApiKey(apiKey?: string): this {
    this.context.apiKey = apiKey
    return this
  }

  setPostgresClient(client: PostgresClient): this {
    this.context.postgresClient = client
    return this
  }

  setServarrClient(client?: ServarrManager): this {
    this.context.servarrClient = client
    return this
  }

  setQBittorrentClient(client?: QBittorrentManager): this {
    this.context.qbittorrentClient = client
    return this
  }

  setProwlarrExtrasClient(client?: ProwlarrExtrasClient): this {
    this.context.prowlarrExtrasClient = client
    return this
  }

  setSabnzbdClient(client?: SabnzbdManager): this {
    this.context.sabnzbdClient = client
    return this
  }

  setLazyLibrarianClient(client?: LazyLibrarianClient): this {
    this.context.lazyLibrarianClient = client
    return this
  }

  setBazarrClient(client?: BazarrManager): this {
    this.context.bazarrClient = client
    return this
  }

  setExecutionMode(mode: 'init' | 'sidecar'): this {
    this.context.executionMode = mode
    return this
  }

  build(): StepContext {
    if (!this.context.config) {
      throw new Error('Configuration is required')
    }
    if (!this.context.postgresClient) {
      throw new Error('PostgreSQL client is required')
    }
    if (
      !this.context.servarrClient &&
      !this.context.bazarrClient &&
      !this.context.qbittorrentClient &&
      !this.context.sabnzbdClient &&
      !this.context.lazyLibrarianClient
    ) {
      throw new Error(
        'At least one of Servarr, Bazarr, qBittorrent, SABnzbd or LazyLibrarian client is required',
      )
    }
    if (!this.context.servarrType) {
      throw new Error('Servarr type is required')
    }
    if (!this.context.executionMode) {
      throw new Error('Execution mode is required')
    }

    return this.context as StepContext
  }
}
