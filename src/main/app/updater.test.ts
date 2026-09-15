import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UpdateDownloadedEvent, UpdateInfo } from 'electron-updater'

const calls = vi.hoisted(() => ({
  checkForUpdates: 0,
  downloadUpdate: 0,
  quitAndInstall: [] as [boolean, boolean][]
}))

const electronState = vi.hoisted(() => ({ isPackaged: true }))

vi.mock('../logging', () => ({
  getLogger: () => ({
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined
  })
}))

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return electronState.isPackaged
    },
    getVersion: () => '1.0.0'
  }
}))

vi.mock('electron-updater', async () => {
  const { EventEmitter } = await import('events')
  class FakeAutoUpdater extends EventEmitter {
    autoDownload = true
    autoInstallOnAppQuit = true
    logger: unknown = null
    checkForUpdates(): Promise<null> {
      calls.checkForUpdates++
      return Promise.resolve(null)
    }
    downloadUpdate(): Promise<string[]> {
      calls.downloadUpdate++
      return Promise.resolve([])
    }
    quitAndInstall(isSilent = false, isForceRunAfter = false): void {
      calls.quitAndInstall.push([isSilent, isForceRunAfter])
    }
  }
  return { autoUpdater: new FakeAutoUpdater() }
})

import { autoUpdater } from 'electron-updater'
import { UpdaterService } from './updater'

/** electron-updater's real UpdateInfo/UpdateDownloadedEvent carry file-manifest
 * fields (files, sha512, ...) that UpdaterService never reads; tests only need
 * the fields it actually consumes. */
function fakeUpdateInfo(partial: Partial<UpdateInfo>): UpdateInfo {
  return { version: '0.0.0', releaseDate: '', files: [], path: '', sha512: '', ...partial }
}
function fakeDownloaded(partial: Partial<UpdateDownloadedEvent>): UpdateDownloadedEvent {
  return {
    ...fakeUpdateInfo(partial),
    downloadedFile: '',
    ...partial
  }
}

describe('UpdaterService', () => {
  beforeEach(() => {
    electronState.isPackaged = true
    calls.checkForUpdates = 0
    calls.downloadUpdate = 0
    calls.quitAndInstall = []
    autoUpdater.removeAllListeners()
  })

  it('never auto-downloads or auto-installs on quit — installs only follow an explicit click', () => {
    new UpdaterService(() => true)
    expect(autoUpdater.autoDownload).toBe(false)
    expect(autoUpdater.autoInstallOnAppQuit).toBe(false)
  })

  it('walks checking → available → downloading → ready, updating status at each step', () => {
    const updater = new UpdaterService(() => true)
    expect(updater.getStatus().state).toBe('idle')

    autoUpdater.emit('checking-for-update')
    expect(updater.getStatus().state).toBe('checking')

    autoUpdater.emit(
      'update-available',
      fakeUpdateInfo({
        version: '1.2.3',
        releaseDate: '2026-01-01T00:00:00.000Z',
        releaseNotes: 'Fixed a bug'
      })
    )
    let status = updater.getStatus()
    expect(status.state).toBe('available')
    expect(status.availableVersion).toBe('1.2.3')
    expect(status.releaseNotes).toBe('Fixed a bug')
    expect(updater.canInstall()).toBe(false)

    autoUpdater.emit('download-progress', {
      percent: 42.6,
      bytesPerSecond: 1024,
      total: 0,
      delta: 0,
      transferred: 0
    })
    status = updater.getStatus()
    expect(status.state).toBe('downloading')
    expect(status.percent).toBe(43)

    autoUpdater.emit('update-downloaded', fakeDownloaded({ version: '1.2.3' }))
    status = updater.getStatus()
    expect(status.state).toBe('ready')
    expect(status.percent).toBe(100)
    expect(updater.canInstall()).toBe(true)
  })

  it('renders a joined multi-entry changelog when fullChangelog is on', () => {
    const updater = new UpdaterService(() => true)
    autoUpdater.emit(
      'update-available',
      fakeUpdateInfo({
        version: '1.2.3',
        releaseDate: '2026-01-01T00:00:00.000Z',
        releaseNotes: [
          { version: '1.2.3', note: 'Second fix' },
          { version: '1.2.2', note: 'First fix' }
        ]
      })
    )
    expect(updater.getStatus().releaseNotes).toBe('Second fix\n\nFirst fix')
  })

  it('sets state to error without throwing when electron-updater reports one', () => {
    const updater = new UpdaterService(() => true)
    expect(() => autoUpdater.emit('error', new Error('network unreachable'))).not.toThrow()
    const status = updater.getStatus()
    expect(status.state).toBe('error')
    expect(status.error).toBe('network unreachable')
  })

  it('never calls checkForUpdates when unpackaged, and reports itself disabled', async () => {
    electronState.isPackaged = false
    const updater = new UpdaterService(() => true)
    expect(updater.getStatus().state).toBe('disabled')
    await updater.check(true)
    expect(calls.checkForUpdates).toBe(0)
    expect(updater.getStatus().state).toBe('disabled')
  })

  it('only downloads once a version is available, and only installs once one is ready', async () => {
    const updater = new UpdaterService(() => true)
    await updater.download()
    expect(calls.downloadUpdate).toBe(0)
    expect(updater.canInstall()).toBe(false)

    autoUpdater.emit('update-available', fakeUpdateInfo({ version: '1.2.3' }))
    await updater.download()
    expect(calls.downloadUpdate).toBe(1)

    // quitAndInstall() itself does not gate on state — callers must check
    // canInstall() first (src/main/index.ts requestQuitAndInstall does).
    updater.quitAndInstall()
    expect(calls.quitAndInstall).toEqual([[false, true]])
  })

  it('background checks are skipped once a download is in progress or ready to install', () => {
    const autoCheck = vi.fn(() => true)
    const updater = new UpdaterService(autoCheck)
    autoUpdater.emit('update-available', fakeUpdateInfo({ version: '1.2.3' }))
    autoUpdater.emit('download-progress', {
      percent: 10,
      bytesPerSecond: 1,
      total: 0,
      delta: 0,
      transferred: 0
    })
    expect(updater.getStatus().state).toBe('downloading')

    void updater.check(false)
    // check() itself short-circuits while downloading/ready — see updater.ts.
    expect(calls.checkForUpdates).toBe(0)
  })
})
