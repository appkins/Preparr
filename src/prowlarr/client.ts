import type { IndexerProxy } from '@/config/schema'
import { logger } from '@/utils/logger'

/**
 * The Prowlarr objects the generated tsarr client cannot reach.
 *
 * tsarr exposes tags (getTags/addTag) but has no indexer-proxy methods -- only
 * the IndexerProxyResource type -- so /api/v1/indexerproxy is driven directly
 * here. Tags go the same way to keep one transport and one error shape.
 */

export interface ProwlarrExtrasConfig {
  url: string
  apiKey: string
}

export interface Tag {
  id: number
  label: string
}

/** Lowercased tag label to the id Prowlarr assigned it. */
export type TagIds = Record<string, number>

interface ProxyResource {
  id: number
  name: string
  implementation: string
  implementationName?: string
  configContract: string
  fields?: Array<{ name: string; value: unknown }>
  tags?: number[]
  [key: string]: unknown
}

interface IndexerResource {
  id: number
  name: string
  tags?: number[]
  [key: string]: unknown
}

export class ProwlarrExtrasClient {
  private config: ProwlarrExtrasConfig

  constructor(config: ProwlarrExtrasConfig) {
    this.config = config
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    body?: unknown,
  ): Promise<T> {
    const response = await fetch(`${this.config.url.replace(/\/$/, '')}/api/v1/${path}`, {
      method,
      headers: {
        'X-Api-Key': this.config.apiKey,
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })

    if (!response.ok) {
      throw new Error(`Prowlarr ${method} /${path} failed with ${response.status}`)
    }

    return (await response.json()) as T
  }

  /**
   * Create any label that does not already exist and return the full map.
   *
   * Prowlarr owns tag ids: POSTing one that is already taken fails with
   * "Can't insert model with existing ID", so a tag is only ever created by
   * label and its id read back.
   */
  async ensureTags(labels: string[]): Promise<TagIds> {
    const wanted = [...new Set(labels.map((l) => l.toLowerCase()))].filter(Boolean)
    const existing = await this.request<Tag[]>('GET', 'tag')

    const ids: TagIds = {}
    for (const tag of existing) {
      ids[tag.label.toLowerCase()] = tag.id
    }

    for (const label of wanted) {
      if (ids[label] !== undefined) {
        continue
      }

      logger.info('Creating Prowlarr tag', { label })
      const created = await this.request<Tag>('POST', 'tag', { label })
      ids[label] = created.id
    }

    return ids
  }

  /** Tag ids for the given labels, dropping any the instance does not know. */
  private resolveTags(labels: string[], tagIds: TagIds): number[] {
    return [
      ...new Set(
        labels
          .map((label) => tagIds[label.toLowerCase()])
          .filter((id): id is number => id !== undefined),
      ),
    ]
  }

  async syncIndexerProxies(
    proxies: IndexerProxy[],
    tagIds: TagIds,
  ): Promise<{ created: string[]; updated: string[] }> {
    const created: string[] = []
    const updated: string[] = []

    if (proxies.length === 0) {
      return { created, updated }
    }

    const current = await this.request<ProxyResource[]>('GET', 'indexerproxy')

    for (const want of proxies) {
      const tags = this.resolveTags(want.tags, tagIds)
      const have = current.find((p) => p.name === want.name)

      if (!have) {
        logger.info('Creating Prowlarr indexer proxy', { name: want.name })
        await this.request('POST', 'indexerproxy', {
          onHealthIssue: false,
          includeHealthWarnings: false,
          name: want.name,
          implementation: want.implementation,
          implementationName: want.implementationName ?? want.implementation,
          configContract: want.configContract,
          fields: want.fields,
          tags,
        })
        created.push(want.name)
        continue
      }

      // A PUT replaces the resource, so the declared fields are overlaid onto
      // whatever Prowlarr already holds rather than replacing the list --
      // otherwise every setting outside this config is dropped.
      const fields = [...(have.fields ?? [])]
      for (const field of want.fields) {
        const index = fields.findIndex((f) => f.name === field.name)
        if (index >= 0) {
          fields[index] = { ...fields[index], name: field.name, value: field.value }
        } else {
          fields.push({ name: field.name, value: field.value })
        }
      }

      const merged: ProxyResource = {
        ...have,
        implementation: want.implementation,
        implementationName: want.implementationName ?? want.implementation,
        configContract: want.configContract,
        fields,
        tags,
      }

      if (this.sameProxy(have, merged)) {
        continue
      }

      logger.info('Updating Prowlarr indexer proxy', { name: want.name, id: have.id })
      await this.request('PUT', `indexerproxy/${have.id}`, merged)
      updated.push(want.name)
    }

    return { created, updated }
  }

  private sameProxy(a: ProxyResource, b: ProxyResource): boolean {
    const shape = (p: ProxyResource) =>
      JSON.stringify({
        name: p.name,
        implementation: p.implementation,
        configContract: p.configContract,
        tags: [...(p.tags ?? [])].sort((x, y) => x - y),
        fields: [...(p.fields ?? [])]
          .map((f) => ({ name: f.name, value: f.value }))
          .sort((x, y) => x.name.localeCompare(y.name)),
      })

    return shape(a) === shape(b)
  }

  /**
   * Union the resolved ids into each named indexer's tags.
   *
   * Unioned rather than replaced so a tag applied by hand for some other
   * purpose survives, and applied here at all because IndexersStep matches on
   * name only and never updates an indexer it already found.
   */
  async syncIndexerTags(
    indexerTags: Record<string, string[]>,
    tagIds: TagIds,
  ): Promise<{ tagged: string[]; skipped: string[] }> {
    const tagged: string[] = []
    const skipped: string[] = []

    const names = Object.keys(indexerTags)
    if (names.length === 0) {
      return { tagged, skipped }
    }

    const current = await this.request<IndexerResource[]>('GET', 'indexer')

    for (const [name, labels] of Object.entries(indexerTags)) {
      const have = current.find((i) => i.name === name)

      if (!have) {
        logger.debug('Indexer not present yet, leaving its tags for a later pass', { name })
        skipped.push(name)
        continue
      }

      const existing = [...new Set(have.tags ?? [])].sort((a, b) => a - b)
      const merged = [...new Set([...existing, ...this.resolveTags(labels, tagIds)])].sort(
        (a, b) => a - b,
      )

      if (merged.length === existing.length) {
        continue
      }

      logger.info('Tagging Prowlarr indexer', { name, tags: merged })
      await this.request('PUT', `indexer/${have.id}`, { ...have, tags: merged })
      tagged.push(name)
    }

    return { tagged, skipped }
  }
}
