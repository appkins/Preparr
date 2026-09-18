import { logger } from '@/utils/logger'

/**
 * Tdarr's server API.
 *
 * Nearly everything Tdarr keeps -- libraries, flows, user variables, global
 * settings, each node's saved limits -- lives in named collections behind one
 * endpoint, /api/v2/cruddb, which takes a collection, a mode and a document.
 * insert names the document after the docID it is given; update is a shallow
 * merge of the keys sent over the keys stored; getById answers a missing
 * document with an empty body rather than an error.
 *
 * A handful of things are actions rather than documents and have endpoints of
 * their own: watching a library's folder, scanning it, and pushing settings
 * to a node that is connected right now.
 *
 * Authentication, when Tdarr has it switched on, is an x-api-key header. With
 * it off the header is ignored, but it is only sent when there is a key: an
 * empty header would be looked up as a key of "" once auth is turned on.
 */

export type TdarrCollection =
  | 'SettingsGlobalJSONDB'
  | 'LibrarySettingsJSONDB'
  | 'NodeJSONDB'
  | 'VariablesJSONDB'
  | 'FlowsJSONDB'
  | 'ApiKeysJSONDB'
  | 'UsersJSONDB'
  | 'StatisticsJSONDB'

export interface TdarrDocument {
  _id: string
  [key: string]: unknown
}

/** A node as /get-nodes reports it: its saved settings plus live state. */
export interface TdarrConnectedNode extends TdarrDocument {
  nodeName: string
}

export type TdarrScanMode = 'scanFresh' | 'scanFindNew'

export interface TdarrStatus {
  status: string
  version?: string
  [key: string]: unknown
}

export interface TdarrClientOptions {
  url: string
  apiKey?: string | undefined
  fetchImpl?: typeof fetch
}

export class TdarrClient {
  private readonly url: string
  private readonly apiKey: string | undefined
  private readonly fetchImpl: typeof fetch

  constructor(options: TdarrClientOptions) {
    this.url = options.url.replace(/\/$/, '')
    this.apiKey = options.apiKey || undefined
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const response = await this.fetchImpl(`${this.url}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey ? { 'x-api-key': this.apiKey } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })

    const text = await response.text()

    if (!response.ok) {
      throw new Error(
        `Tdarr ${method} ${path} failed with ${response.status}: ${text.slice(0, 200)}`,
      )
    }

    // Actions answer "OK" as text; a missing document answers nothing at all.
    if (text === '') {
      return undefined as T
    }
    try {
      return JSON.parse(text) as T
    } catch {
      return text as T
    }
  }

  private cruddb<T>(data: Record<string, unknown>): Promise<T> {
    return this.request<T>('POST', '/api/v2/cruddb', { data })
  }

  /** Server status. Public: it answers whether or not auth is on. */
  status(): Promise<TdarrStatus> {
    return this.request<TdarrStatus>('GET', '/api/v2/status')
  }

  /**
   * Whether the API answers and the key is accepted.
   *
   * Reads a collection rather than the status endpoint, because the status
   * endpoint answers without a key even when one is required, and so proves
   * only that something is listening.
   */
  async ping(): Promise<boolean> {
    try {
      await this.getAll('SettingsGlobalJSONDB')
      return true
    } catch (error) {
      logger.debug('Tdarr is not reachable', { error })
      return false
    }
  }

  async getAll<T extends TdarrDocument = TdarrDocument>(collection: TdarrCollection): Promise<T[]> {
    const result = await this.cruddb<T[] | undefined>({ collection, mode: 'getAll' })
    return Array.isArray(result) ? result : []
  }

  getById<T extends TdarrDocument = TdarrDocument>(
    collection: TdarrCollection,
    docID: string,
  ): Promise<T | undefined> {
    return this.cruddb<T | undefined>({ collection, mode: 'getById', docID })
  }

  /** Create a document under the given id. Tdarr sets `_id` to it itself. */
  async insert(
    collection: TdarrCollection,
    docID: string,
    obj: Record<string, unknown>,
  ): Promise<void> {
    await this.cruddb({ collection, mode: 'insert', docID, obj })
  }

  /** Merge the given keys into the document. Keys not sent are untouched. */
  async update(
    collection: TdarrCollection,
    docID: string,
    obj: Record<string, unknown>,
  ): Promise<void> {
    await this.cruddb({ collection, mode: 'update', docID, obj })
  }

  async removeOne(collection: TdarrCollection, docID: string): Promise<void> {
    await this.cruddb({ collection, mode: 'removeOne', docID })
  }

  /** Nodes connected right now, keyed by node id. */
  async getNodes(): Promise<Record<string, TdarrConnectedNode>> {
    const nodes = await this.request<Record<string, TdarrConnectedNode> | undefined>(
      'GET',
      '/api/v2/get-nodes',
    )
    return nodes ?? {}
  }

  /**
   * Update a connected node. The server applies it to the live node and
   * saves the settings it knows about under the node's name.
   */
  async updateNode(nodeID: string, nodeUpdates: Record<string, unknown>): Promise<void> {
    await this.request('POST', '/api/v2/update-node', { data: { nodeID, nodeUpdates } })
  }

  /**
   * Start or stop the watcher on a library's folder. The library document's
   * folderWatching flag is separate: it decides what happens at the next
   * server start, this decides what happens now.
   */
  async toggleFolderWatch(dbID: string, folder: string, status: boolean): Promise<void> {
    await this.request('POST', '/api/v2/toggle-folder-watch', {
      data: { auto: false, folder, dbID, status },
    })
  }

  async scanFiles(dbID: string, mode: TdarrScanMode, folder: string): Promise<void> {
    await this.request('POST', '/api/v2/scan-files', {
      data: { scanConfig: { dbID, mode, arrayOrPath: folder } },
    })
  }
}
