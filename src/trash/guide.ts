import { logger } from '@/utils/logger'
import type { TrashCustomFormat } from './convert'

/**
 * Reads custom format definitions out of the TRaSH Guides repository.
 *
 * The guides key a format by trash_id but name the file after the format, so
 * there is no way to fetch one by id directly and no published index to read
 * instead. The whole directory is therefore fetched once and indexed by id.
 *
 * That is ~220 small files per app, once per process -- an init container at
 * startup, a sidecar once for the life of the pod. The two alternatives are
 * worse: cloning the repository costs a git binary and a volume to keep it on,
 * and its tarball is 25MB of mostly images for 200KB of JSON.
 *
 * Both the listing and the files come from jsDelivr rather than from GitHub
 * directly. GitHub's contents API is the only way it will list a directory and
 * it allows 60 unauthenticated calls an hour per address, which a handful of
 * pods restarting exhausts -- the failure being a 403 at startup with the
 * budget already spent. jsDelivr needs no credentials and imposes no such
 * limit. Its listing is not always complete, so an id it cannot resolve is
 * reported as an error rather than quietly skipped.
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

  /** Lists the whole repository; the app's own directory is filtered out of it. */
  private get listingUrl(): string {
    return `https://data.jsdelivr.com/v1/packages/gh/TRaSH-Guides/Guides@${this.ref}?structure=flat`
  }

  private get directory(): string {
    return `/docs/json/${this.app}/cf/`
  }

  private fileUrl(path: string): string {
    return `https://cdn.jsdelivr.net/gh/TRaSH-Guides/Guides@${this.ref}${path}`
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

    const listing = await this.fetchJson<{ files: Array<{ name: string }> }>(this.listingUrl)
    const names = (listing.files ?? [])
      .map((file) => file.name)
      .filter((name) => name.startsWith(this.directory) && name.endsWith('.json'))

    logger.info('Indexing TRaSH Guides custom formats', { app: this.app, count: names.length })

    const index = new Map<string, TrashCustomFormat>()
    const queue = [...names]

    const worker = async (): Promise<void> => {
      for (let name = queue.shift(); name !== undefined; name = queue.shift()) {
        try {
          const format = await this.fetchJson<TrashCustomFormat>(this.fileUrl(name))
          if (format?.trash_id) {
            index.set(format.trash_id, format)
          }
        } catch (error) {
          // The listing and the files are not perfectly consistent: jsDelivr
          // lists paths its CDN then 404s. Losing one file must not cost the
          // whole index, and an id that is actually referenced still fails
          // loudly in resolve().
          logger.debug('Skipping a TRaSH Guides file that could not be read', { name, error })
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
