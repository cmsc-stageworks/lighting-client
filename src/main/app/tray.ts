import { app, Menu, nativeImage, Tray, type BrowserWindow } from 'electron'
import type { RuntimeSnapshot } from '@shared/types/state'
import type { Services } from '../services'

/** 16×16 circle icon in a status color, generated at runtime (no asset needed). */
function dotIcon(color: string): Electron.NativeImage {
  const size = 32
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32"><circle cx="16" cy="16" r="11" fill="${color}"/><circle cx="16" cy="16" r="14" fill="none" stroke="${color}" stroke-opacity="0.35" stroke-width="2"/></svg>`
  const img = nativeImage.createFromDataURL(
    `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
  )
  return img.resize({ width: 16, height: 16 })
}

export function createTray(services: Services, getWindow: () => BrowserWindow | null): Tray {
  const tray = new Tray(dotIcon('#8b98a9'))
  tray.setToolTip('CMSC Lighting Client')

  const show = (): void => {
    const w = getWindow()
    if (!w) return
    if (w.isMinimized()) w.restore()
    w.show()
    w.focus()
  }

  const rebuild = (snap: RuntimeSnapshot): void => {
    const outputs = Object.values(snap.outputs)
    const anyError =
      outputs.some((o) => o.state === 'error') ||
      snap.thorium.state === 'error' ||
      snap.mqtt.state === 'error'
    const anyWarn =
      snap.thorium.state === 'reconnecting' ||
      snap.mqtt.state === 'reconnecting' ||
      outputs.some((o) => o.state === 'starting')
    const color = snap.compositor.blackout
      ? '#ff5d5d'
      : anyError
        ? '#ff5d5d'
        : anyWarn
          ? '#ffb454'
          : '#3ddc97'
    tray.setImage(dotIcon(color))
    const status = [
      `Thorium: ${snap.thorium.state}`,
      `MQTT: ${snap.mqtt.state}`,
      `Outputs: ${outputs.filter((o) => o.state === 'ok').length}/${outputs.length} ok`
    ]
    tray.setToolTip(`CMSC Lighting Client\n${status.join('\n')}`)
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Show', click: show },
        { type: 'separator' },
        ...status.map((s) => ({ label: s, enabled: false })),
        { type: 'separator' },
        {
          label: snap.compositor.blackout ? 'Release blackout' : 'Blackout',
          click: () => services.setBlackout(!snap.compositor.blackout)
        },
        { label: 'Release all scenes', click: () => services.releaseAll() },
        { type: 'separator' },
        { label: 'Quit', click: () => app.quit() }
      ])
    )
  }

  rebuild(services.snapshot())
  services.on('snapshot', rebuild)
  tray.on('click', show)
  tray.on('double-click', show)
  return tray
}
