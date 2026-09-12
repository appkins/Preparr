import { logger } from '@/utils/logger'
import type { TrashCustomFormat } from './convert'

/**
 * Reads custom format definitions out of the TRaSH Guides repository.
 *
 * The guides key a format by trash_id but name the file after the format, so
 * there is no way to fetch one by id directly and no published index to read
 * instead. The whole directory is therefore fetched once and indexed by id.
 *
 * That is ~240 small files per app. It happens once per process -- an init
 * container runs it at startup, a sidecar once for the life of the pod -- and
 * the alternative, cloning the repository, costs a git binary and a volume to
 * keep it on.
 */

const DEFAULT_REF = 'master'
const CONCURRENCY = 8

export interface TrashGuideOptions {
  app: 'radarr' | 'sonarr'
  fetchImpl?: (url: string) => Promise<Response>
  ref?: string
}

export class TrashGuide {
  private readonly app: 'radarr' | 'sonarr'
  private readonly fetchImpl: (url: string) => Promise<Response>
  private readonly ref: string
  private index: Map<string, TrashCustomFormat> | null = null

  constructor(options: TrashGuideOptions) {
    this.app = options.app
    this.fetchImpl = options.fetchImpl ?? ((url) => fetch(url))
    this.ref = options.ref ?? DEFAULT_REF
  }

  private get listingUrl(): string {
    return `https://api.github.com/repos/TRaSH-Guides/Guides/contents/docs/json/${this.app}/cf?ref=${this.ref}`
  }

  private fileUrl(name: string): string {
    return `https://raw.githubusercontent.com/TRaSH-Guides/Guides/${this.ref}/docs/json/${this.app}/cf/${name}`
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const response = await this.fetchImpl(url)

    if (!response.ok) {
      throw new Error(`TRaSH Guides request failed with ${response.status}: ${url}`)
    }

    return (await response.json()) as T
  }

  private async buildIndex(): Promise<Map<string, TrashCustomFormat>> {
    if (this.index) {
      return this.index
    }

    const listing = await this.fetchJson<Array<{ name: string; type: string }>>(this.listingUrl)
    const names = listing
      .filter((e) => e.type === 'file' && e.name.endsWith('.json'))
      .map((e) => e.name)

    logger.info('Indexing TRaSH Guides custom formats', { app: this.app, count: names.length })

    const index = new Map<string, TrashCustomFormat>()
    const queue = [...names]

    const worker = async (): Promise<void> => {
      for (let name = queue.shift(); name !== undefined; name = queue.shift()) {
        const format = await this.fetchJson<TrashCustomFormat>(this.fileUrl(name))
        if (format?.trash_id) {
          index.set(format.trash_id, format)
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, names.length) }, worker))

    this.index = index
    return index
  }

  /**
   * Definitions for the given ids.
   *
   * An id the guides do not define is an error rather than an omission: the
   * format would simply go unscored, leaving a profile that looks configured
   * and behaves as though the entry were never written.
   */
  async resolve(trashIds: string[]): Promise<Map<string, TrashCustomFormat>> {
    const wanted = [...new Set(trashIds)]
    if (wanted.length === 0) {
      return new Map()
    }

    const index = await this.buildIndex()

    const resolved = new Map<string, TrashCustomFormat>()
    const missing: string[] = []

    for (const id of wanted) {
      const format = index.get(id)
      if (format) {
        resolved.set(id, format)
      } else {
        missing.push(id)
      }
    }

    if (missing.length > 0) {
      throw new Error(
        `TRaSH Guides has no ${this.app} custom format with these ids: ${missing.join(', ')}`,
      )
    }

    return resolved
  }
}
