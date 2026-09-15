import { EventEmitter } from 'events'
import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { ReleaseNoteInfo } from 'builder-util-runtime'
import type { UpdateStatus } from '@shared/types/state'
import { getLogger } from '../logging'

const log = getLogger('updater')

const FIRST_CHECK_DELAY_MS = 30_000
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

function renderNotes(notes: string | ReleaseNoteInfo[] | null | undefined): string | null {
  if (!notes) return null
  if (typeof notes === 'string') return notes
  const joined = notes
    .map((n) => n.note)
    .filter((n): n is string => Boolean(n))
    .join('\n\n')
  return joined || null
}

/**
 * Thin wrapper around electron-updater's github provider (see electron-builder.yml
 * `publish` and `docs/PRD_claude.md` "Auto-update"). Never downloads or installs
 * without an explicit call from the renderer — this app drives live DMX output
 * during a show and must never restart itself unattended.
 *
 * `quitAndInstall()` is intentionally NOT exposed here as a one-call action: the
 * caller (src/main/index.ts `requestQuitAndInstall`) must run its own graceful
 * shutdown (zero DMX frame, stop outputs) first, then call `quitAndInstall()` —
 * electron-updater spawns the installer synchronously inside that call, before
 * the `before-quit` it fires afterward, so sequencing here is what guarantees
 * outputs go dark before the installer runs.
 */
export class UpdaterService extends EventEmitter {
  readonly enabled: boolean
  private status: UpdateStatus
  private firstCheckTimer: ReturnType<typeof setTimeout> | null = null
  private intervalTimer: ReturnType<typeof setInterval> | null = null

  constructor(private readonly autoCheckEnabled: () => boolean) {
    super()
    this.enabled = app.isPackaged
    this.status = {
      state: this.enabled ? 'idle' : 'disabled',
      currentVersion: app.getVersion(),
      availableVersion: null,
      releaseNotes: null,
      releaseDate: null,
      percent: 0,
      bytesPerSecond: 0,
      lastCheckedAt: null,
      error: null
    }
    if (!this.enabled) return

    autoUpdater.logger = log
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = false

    autoUpdater.on('checking-for-update', () => this.patch({ state: 'checking', error: null }))
    autoUpdater.on('update-available', (info) => {
      this.patch({
        state: 'available',
        availableVersion: info.version,
        releaseNotes: renderNotes(info.releaseNotes),
        releaseDate: info.releaseDate ?? null,
        lastCheckedAt: Date.now()
      })
    })
    autoUpdater.on('update-not-available', () => {
      this.patch({ state: 'idle', availableVersion: null, lastCheckedAt: Date.now() })
    })
    autoUpdater.on('download-progress', (p) => {
      this.patch({
        state: 'downloading',
        percent: Math.round(p.percent),
        bytesPerSecond: Math.round(p.bytesPerSecond)
      })
    })
    autoUpdater.on('update-downloaded', (info) => {
      this.patch({ state: 'ready', percent: 100, availableVersion: info.version })
    })
    autoUpdater.on('error', (err) => {
      log.error('update error', err)
      this.patch({ state: 'error', error: err.message })
    })
  }

  /** Schedules the first background check, then a recurring one. No-op when unpackaged. */
  start(): void {
    if (!this.enabled) return
    this.firstCheckTimer = setTimeout(() => {
      this.firstCheckTimer = null
      if (this.autoCheckEnabled()) void this.check(false)
      this.intervalTimer = setInterval(() => {
        if (!this.autoCheckEnabled()) return
        // Don't clobber a download in progress or a build the user already has staged.
        if (this.status.state === 'downloading' || this.status.state === 'ready') return
        void this.check(false)
      }, CHECK_INTERVAL_MS)
    }, FIRST_CHECK_DELAY_MS)
  }

  stop(): void {
    if (this.firstCheckTimer) clearTimeout(this.firstCheckTimer)
    this.firstCheckTimer = null
    if (this.intervalTimer) clearInterval(this.intervalTimer)
    this.intervalTimer = null
  }

  getStatus(): UpdateStatus {
    return this.status
  }

  async check(manual: boolean): Promise<UpdateStatus> {
    if (!this.enabled) return this.status
    if (this.status.state === 'downloading' || this.status.state === 'ready') return this.status
    try {
      await autoUpdater.checkForUpdates()
    } catch (err) {
      // autoUpdater's own 'error' event already updated status; this catch just
      // stops an unhandled rejection when the caller doesn't await us (background checks).
      if (manual) log.warn('manual update check failed', err)
    }
    return this.status
  }

  async download(): Promise<void> {
    if (!this.enabled || this.status.state !== 'available') return
    try {
      await autoUpdater.downloadUpdate()
    } catch (err) {
      log.error('update download failed', err)
    }
  }

  canInstall(): boolean {
    return this.enabled && this.status.state === 'ready'
  }

  /** Spawns the installer and (indirectly, via electron-updater's internal
   *  `app.quit()`) triggers the app's normal before-quit sequence. Callers must
   *  have already finished their own graceful shutdown before calling this. */
  quitAndInstall(): void {
    autoUpdater.quitAndInstall(false, true)
  }

  private patch(next: Partial<UpdateStatus>): void {
    this.status = { ...this.status, ...next }
    this.emit('changed', this.status)
  }
}
