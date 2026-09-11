import type { SabnzbdConfig, SabnzbdServer, ServiceIntegration } from '@/config/schema'
import { logger } from '@/utils/logger'

/**
 * SABnzbd, the usenet counterpart to the qBittorrent manager.
 *
 * Two things differ from qBittorrent and shape this class:
 *
 *  - There is no login handshake. Every call carries `apikey`, so there is no
 *    session cookie to hold and no ordering requirement between connecting and
 *    configuring.
 *  - Failures come back as HTTP 200 with `{"status": false, "error": ...}`
 *    rather than a non-2xx status, so the response body has to be inspected;
 *    checking `response.ok` alone reports a rejected API key as success.
 */
export class SabnzbdManager {
  private config: ServiceIntegration['sabnzbd']
  private isInitialized = false

  constructor(config: ServiceIntegration['sabnzbd']) {
    this.config = config
  }

  /**
   * One SABnzbd API call. Sent as a POST form rather than a query string so
   * that server passwords do not end up in access logs or process listings.
   */
  private async call(
    mode: string,
    params: Record<string, string | number | boolean> = {},
  ): Promise<{ ok: boolean; body: unknown }> {
    if (!this.config) {
      throw new Error('SABnzbd configuration not provided')
    }

    const form = new URLSearchParams()
    form.set('mode', mode)
    form.set('output', 'json')
    if (this.config.apiKey) {
      form.set('apikey', this.config.apiKey)
    }
    for (const [key, value] of Object.entries(params)) {
      form.set(key, typeof value === 'boolean' ? (value ? '1' : '0') : String(value))
    }

    const response = await fetch(`${this.config.url}/api`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    })

    if (!response.ok) {
      return { ok: false, body: undefined }
    }

    const body = (await response.json().catch(() => undefined)) as unknown

    // An explicit {status: false} is SABnzbd reporting a rejected key or a bad
    // request; anything else (including {version: ...}) is a success.
    const rejected =
      typeof body === 'object' && body !== null && (body as { status?: unknown }).status === false

    return { ok: !rejected, body }
  }

  async testConnection(): Promise<boolean> {
    if (!this.config) {
      logger.warn('SABnzbd configuration not provided')
      return false
    }

    try {
      const { ok } = await this.call('version')
      return ok
    } catch (error) {
      logger.debug('SABnzbd connection test failed', { error })
      return false
    }
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      logger.debug('SabnzbdManager already initialized')
      return
    }

    if (!this.config) {
      logger.info('SABnzbd configuration not provided, skipping initialization')
      return
    }

    logger.info('Initializing SABnzbd...', { url: this.config.url })

    if (!(await this.testConnection())) {
      throw new Error('Cannot reach SABnzbd')
    }

    this.isInitialized = true
    logger.info('SABnzbd initialization completed successfully')
  }

  isReady(): boolean {
    return this.isInitialized
  }

  getConfig(): ServiceIntegration['sabnzbd'] {
    return this.config
  }

  async applyConfiguration(config: SabnzbdConfig): Promise<void> {
    if (!config) {
      logger.debug('No SABnzbd configuration provided')
      return
    }

    logger.info('Applying SABnzbd configuration...')

    if (config.downloads) {
      await this.setDownloadPaths(config.downloads.completePath, config.downloads.incompletePath)
    }

    for (const category of config.categories ?? []) {
      await this.addCategory(category.name, category.dir, category.priority, category.script)
    }

    for (const server of config.servers ?? []) {
      await this.addServer(server)
    }

    logger.info('SABnzbd configuration applied successfully')
  }

  /**
   * `complete_dir` and `download_dir` are SABnzbd's own names -- download_dir
   * is where in-progress jobs live, not where finished ones land.
   */
  private async setDownloadPaths(completePath: string, incompletePath: string): Promise<void> {
    await this.setMisc('complete_dir', completePath)
    await this.setMisc('download_dir', incompletePath)
  }

  private async setMisc(keyword: string, value: string): Promise<void> {
    try {
      const { ok } = await this.call('set_config', { section: 'misc', keyword, value })
      if (ok) {
        logger.info('SABnzbd setting applied', { keyword, value })
      } else {
        logger.warn('Failed to apply SABnzbd setting', { keyword, value })
      }
    } catch (error) {
      logger.error('Error applying SABnzbd setting', { keyword, error })
    }
  }

  private async addCategory(
    name: string,
    dir: string,
    priority: number,
    script: string,
  ): Promise<void> {
    try {
      const { ok } = await this.call('set_config', {
        section: 'categories',
        keyword: name,
        name,
        dir,
        priority,
        script,
      })

      if (ok) {
        logger.info('SABnzbd category added', { category: name, dir })
      } else {
        logger.warn('Failed to add SABnzbd category', { category: name })
      }
    } catch (error) {
      logger.error('Error adding SABnzbd category', { category: name, error })
    }
  }

  private async addServer(server: SabnzbdServer): Promise<void> {
    // SABnzbd keys servers by name; without one it would create a nameless
    // entry on every run rather than updating the existing server.
    const name = server.name ?? server.host

    try {
      const { ok } = await this.call('set_config', {
        section: 'servers',
        keyword: name,
        name,
        host: server.host,
        port: server.port,
        connections: server.connections,
        ssl: server.ssl,
        enable: server.enable,
        priority: server.priority,
        ...(server.username ? { username: server.username } : {}),
        ...(server.password ? { password: server.password } : {}),
        ...(server.retention !== undefined ? { retention: server.retention } : {}),
      })

      if (ok) {
        logger.info('SABnzbd server configured', { server: name, host: server.host })
      } else {
        logger.warn('Failed to configure SABnzbd server', { server: name })
      }
    } catch (error) {
      logger.error('Error configuring SABnzbd server', { server: name, error })
    }
  }
}
