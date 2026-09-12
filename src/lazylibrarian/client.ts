import { logger } from '@/utils/logger'

/**
 * LazyLibrarian's configuration API.
 *
 * Two things about it shape this client.
 *
 * It answers 200 to everything. A missing parameter, an unknown setting and a
 * successful write are all HTTP 200; the body is the only thing that says
 * which happened, and on failure it is a sentence rather than a structure. So
 * the body is inspected, and anything that reads as one of its failures is
 * raised rather than returned.
 *
 * readCFG answers with the value wrapped in literal square brackets --
 * f"[{value}]" -- which is formatting, not data, and has to come off before
 * the value can be compared to anything.
 *
 * Note also that `group` does not select the setting: LazyLibrarian looks a
 * setting up by name across the whole configuration, and uses the group only
 * to decide which section of the file to save. A name is therefore expected to
 * be unique, which its own configuration relies on too.
 */

export interface LazyLibrarianClientOptions {
  url: string
  apiKey: string
  fetchImpl?: (url: string) => Promise<Response>
}

/** Prefixes LazyLibrarian uses when it is telling you something went wrong. */
const FAILURES = [/^Missing parameter:/, /not found in config/, /^No config entry for/, /^Invalid /]

export class LazyLibrarianClient {
  private readonly url: string
  private readonly apiKey: string
  private readonly fetchImpl: (url: string) => Promise<Response>

  constructor(options: LazyLibrarianClientOptions) {
    this.url = options.url.replace(/\/$/, '')
    this.apiKey = options.apiKey
    this.fetchImpl = options.fetchImpl ?? ((url) => fetch(url))
  }

  private async request(cmd: string, params: Record<string, string> = {}): Promise<string> {
    const url = new URL(`${this.url}/api`)
    url.searchParams.set('apikey', this.apiKey)
    url.searchParams.set('cmd', cmd)

    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value)
    }

    const response = await this.fetchImpl(url.toString())

    if (!response.ok) {
      throw new Error(`LazyLibrarian ${cmd} failed with ${response.status}`)
    }

    const body = (await response.text()).trim()

    if (FAILURES.some((pattern) => pattern.test(body))) {
      throw new Error(`LazyLibrarian ${cmd} failed: ${body}`)
    }

    return body
  }

  async read(group: string, name: string): Promise<string> {
    const body = await this.request('readCFG', { group, name })

    // f"[{value}]" -- strip the one layer the API adds, and only that.
    return body.startsWith('[') && body.endsWith(']') ? body.slice(1, -1) : body
  }

  async write(group: string, name: string, value: string): Promise<void> {
    await this.request('writeCFG', { group, name, value })
  }

  /**
   * Bring the instance to the given settings, writing only what differs.
   *
   * Read first, because the API costs a request per setting either way and a
   * settled instance should cost no writes at all -- and because every write
   * takes a backup of the configuration file, so writing unconditionally
   * leaves a trail of backups behind on every pass.
   */
  async apply(settings: Record<string, Record<string, string>>): Promise<string[]> {
    const changed: string[] = []

    for (const [group, values] of Object.entries(settings)) {
      for (const [name, value] of Object.entries(values)) {
        const current = await this.read(group, name)

        if (current === value) {
          continue
        }

        logger.info('Updating LazyLibrarian setting', { group, name })
        await this.write(group, name, value)
        changed.push(`${group}.${name}`)
      }
    }

    return changed
  }
}
