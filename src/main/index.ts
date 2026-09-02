import { app, BrowserWindow, type Tray } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { getLogger, initLogging } from './logging'
import { Services } from './services'
import { createMainWindow } from './app/window'
import { createTray } from './app/tray'
import { isHeadless, setLaunchAtLogin, startedHidden } from './app/lifecycle'
import { bindPushes, registerIpc } from './ipc/router'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let services: Services | null = null
let quitting = false

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    electronApp.setAppUserModelId('org.cmsc.lighting-client')
    initLogging('info')
    const log = getLogger('main')

    app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

    services = new Services(app.getPath('userData'))
    try {
      await services.init()
    } catch (err) {
      log.error('services failed to start', err)
    }
    initLogging(services.store.settings().logLevel)
    setLaunchAtLogin(
      services.store.settings().launchAtLogin,
      services.store.settings().startMinimized
    )

    registerIpc(services, () => mainWindow)
    bindPushes(services, () => mainWindow)

    const createWindow = (): void => {
      mainWindow = createMainWindow(
        services!.store,
        () => !quitting && services!.store.settings().closeToTray
      )
      mainWindow.on('closed', () => {
        mainWindow = null
      })
      if (startedHidden() || services!.store.settings().startMinimized) {
        // stays hidden; tray handles showing
      }
    }

    if (!isHeadless()) createWindow()
    tray = createTray(services, () => mainWindow)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
      else mainWindow?.show()
    })
    void tray
  })

  app.on('window-all-closed', () => {
    // Keep running in the tray on every platform; quitting is explicit.
  })

  app.on('before-quit', (e) => {
    if (quitting) return
    quitting = true
    if (services) {
      e.preventDefault()
      void services.shutdown().finally(() => {
        services = null
        app.quit()
      })
    }
  })
}
