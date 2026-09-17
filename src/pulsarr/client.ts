import { logger } from '@/utils/logger'
import {
  instanceMatches,
  type PulsarrInstance,
  type PulsarrInstanceRecord,
} from './instance-payload'

/**
 * Pulsarr's REST API.
 *
 * Pulsarr routes Plex watchlist entries into Sonarr and Radarr, and the
 * instances it routes into are the one piece of its configuration that is not
 * an environment variable: they live in its database and are managed over
 * /v1/<app>/instances. Everything else -- Plex tokens, ports, log level -- is
 * env, and so belongs in the Deployment rather than here.
 *
 * Authentication is an X-API-Key header, unlike the Servarr apps' key in the
 * same-named header but a different scheme, and unlike LazyLibrarian's query
 * parameter.
 */

export type PulsarrApp = 'sonarr' | 'radarr'

export interface PulsarrClientOptions {
  url: string

  /**
   * The key, or a resolver for it, matching ProwlarrExtrasClient: the key may
   * not be knowable when the step context is built.
   */
  apiKey: string | (() => string)

  fetchImpl?: typeof fetch
}

export class PulsarrClient {
  private readonly url: string
  private readonly apiKey: string | (() => string)
  private readonly fetchImpl: typeof fetch

  constructor(options: PulsarrClientOptions) {
    this.url = options.url.replace(/\/$/, '')
    this.apiKey = options.apiKey
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  private resolveApiKey(): string {
    return typeof this.apiKey === 'function' ? this.apiKey() : this.apiKey
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<T> {
    const response = await this.fetchImpl(`${this.url}/v1/${path}`, {
      method,
      headers: {
        'X-API-Key': this.resolveApiKey(),
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })

    if (!response.ok) {
      throw new Error(`Pulsarr ${method} /v1/${path} failed with ${response.status}`)
    }

    // DELETE answers 204 with no body.
    const text = await response.text()
    return (text ? JSON.parse(text) : undefined) as T
  }

  /** Whether the API answers, and the key is the right one. */
  async ping(): Promise<boolean> {
    try {
      await this.listInstances('sonarr')
      return true
    } catch (error) {
      logger.debug('Pulsarr is not reachable', { error })
      return false
    }
  }

  async listInstances(app: PulsarrApp): Promise<PulsarrInstanceRecord[]> {
    const instances = await this.request<PulsarrInstanceRecord[]>('GET', `${app}/instances`)
    return instances ?? []
  }

  /**
   * Create or update each declared instance, matched by name.
   *
   * Matched by name because that is the only stable identifier the caller
   * knows: the id is Pulsarr's, assigned at creation. An instance Pulsarr has
   * that is not declared here is left alone -- this configures the instances it
   * is given and does not claim ownership of the whole list.
   */
  async syncInstances(
    app: PulsarrApp,
    desired: PulsarrInstance[],
  ): Promise<{ created: string[]; updated: string[] }> {
    const created: string[] = []
    const updated: string[] = []

    if (desired.length === 0) {
      return { created, updated }
    }

    const current = await this.listInstances(app)

    for (const want of desired) {
      const have = current.find((i) => i.name === want.name)

      if (!have) {
        logger.info('Creating Pulsarr instance', { app, name: want.name })
        await this.request('POST', `${app}/instances`, want)
        created.push(want.name)
        continue
      }

      if (instanceMatches(have as unknown as Record<string, unknown>, want)) {
        continue
      }

      logger.info('Updating Pulsarr instance', { app, name: want.name, id: have.id })
      await this.request('PUT', `${app}/instances/${have.id}`, want)
      updated.push(want.name)
    }

    return { created, updated }
  }
}
