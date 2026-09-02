import { BrowserWindow, screen, shell } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import icon from '../../../resources/icon.png?asset'
import type { ConfigStore } from '../config/store'
import { getLogger } from '../logging'

const rendererLog = getLogger('renderer')

export function createMainWindow(store: ConfigStore, onCloseToTray: () => boolean): BrowserWindow {
  const saved = store.settings().window
  const bounds = saved && isOnScreen(saved) ? saved : { width: 1280, height: 820 }
  const win = new BrowserWindow({
    ...bounds,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    title: 'CMSC Lighting Client',
    backgroundColor: '#0b0f14',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.on('ready-to-show', () => {
    if (!store.settings().startMinimized) win.show()
  })

  // Forward renderer console errors/warnings into the main log for diagnostics.
  win.webContents.on('console-message', (event) => {
    if (event.level === 'error') rendererLog.error(event.message)
    else if (event.level === 'warning') rendererLog.warn(event.message)
  })
  win.webContents.on('render-process-gone', (_e, details) => {
    rendererLog.error(`renderer process gone: ${details.reason}`)
  })

  win.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url)
    return { action: 'deny' }
  })

  let saveTimer: ReturnType<typeof setTimeout> | null = null
  const persistBounds = (): void => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      if (win.isDestroyed() || win.isMinimized()) return
      const b = win.getBounds()
      void store.patchSettings(
        { window: { width: b.width, height: b.height, x: b.x, y: b.y } },
        true
      )
    }, 500)
  }
  win.on('resize', persistBounds)
  win.on('move', persistBounds)

  win.on('close', (e) => {
    if (onCloseToTray()) {
      e.preventDefault()
      win.hide()
    }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}

function isOnScreen(b: { width: number; height: number; x?: number; y?: number }): boolean {
  if (b.x == null || b.y == null) return true
  return screen.getAllDisplays().some((d) => {
    const a = d.workArea
    return b.x! >= a.x - 50 && b.y! >= a.y - 50 && b.x! < a.x + a.width && b.y! < a.y + a.height
  })
}
