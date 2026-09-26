import { app, dialog, Menu, nativeImage, Tray, type BrowserWindow } from 'electron'
import { LIGHTING_MODES, LIGHTING_MODE_INFO, type LightingMode } from '@shared/lightingMode'
import type { RuntimeSnapshot } from '@shared/types/state'
import type { Services } from '../services'

/** 16×16 circle icon in a status color, generated at runtime (no asset needed). */
const iconCache = new Map<string, Electron.NativeImage>()
function dotIcon(color: string): Electron.NativeImage {
  const cached = iconCache.get(color)
  if (cached) return cached
  const size = 32
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32"><circle cx="16" cy="16" r="11" fill="${color}"/><circle cx="16" cy="16" r="14" fill="none" stroke="${color}" stroke-opacity="0.35" stroke-width="2"/></svg>`
  const img = nativeImage
    .createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`)
    .resize({ width: 16, height: 16 })
  iconCache.set(color, img)
  return img
}

export function statusColor(snap: RuntimeSnapshot): string {
  const outputs = Object.values(snap.outputs)
  const anyError =
    outputs.some((o) => o.state === 'error') ||
    snap.thorium.state === 'error' ||
    snap.mqtt.state === 'error'
  const anyWarn =
    snap.thorium.state === 'reconnecting' ||
    snap.mqtt.state === 'reconnecting' ||
    outputs.some((o) => o.state === 'starting')
  if (snap.compositor.blackout || anyError) return '#ff5d5d'
  if (anyWarn) return '#ffb454'
  return '#3ddc97'
}

export function statusLines(snap: RuntimeSnapshot): string[] {
  const outputs = Object.values(snap.outputs)
  const lines = [
    `Thorium: ${snap.thorium.state}`,
    `MQTT: ${snap.mqtt.state}`,
    `Outputs: ${outputs.filter((o) => o.state === 'ok').length}/${outputs.length} ok`,
    `Lighting: ${LIGHTING_MODE_INFO[snap.lightingMode.mode].label}`
  ]
  const group = snap.mappingGroup.groups.find((g) => g.id === snap.mappingGroup.activeId)
  if (group) lines.push(`Mapping group: ${group.name}`)
  if (snap.update.state === 'ready')
    lines.push(`Update ready to install: ${snap.update.availableVersion}`)
  else if (snap.update.state === 'available')
    lines.push(`Update available: ${snap.update.availableVersion}`)
  return lines
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

  const setMode = async (mode: LightingMode): Promise<void> => {
    const current = latest.lightingMode.mode
    if (mode === current) return
    if (mode === 'normal') {
      const { response } = await dialog.showMessageBox({
        type: 'warning',
        buttons: ['Cancel', 'Return to Normal'],
        defaultId: 0,
        cancelId: 0,
        title: 'Return to Normal?',
        message: 'Return to Normal lighting?',
        detail:
          'Full lighting effects will resume. Check that guests with light sensitivity are finished or have agreed.'
      })
      if (response !== 1) return
    }
    await services.setLightingMode(mode, { releaseUncleared: true, catchUpAlerts: true }, 'tray')
  }

  // The snapshot fires ~20×/s and most fields are irrelevant to the tray; only
  // touch the native Tray/Menu when something it actually shows has changed,
  // otherwise NativeImage/Menu handles churn for the life of the process.
  let latest = services.snapshot()
  let lastColor = ''
  let lastMenuKey = ''

  const rebuild = (snap: RuntimeSnapshot): void => {
    latest = snap
    const color = statusColor(snap)
    if (color !== lastColor) {
      tray.setImage(dotIcon(color))
      lastColor = color
    }
    const status = statusLines(snap)
    const menuKey = `${status.join('|')}|${snap.compositor.blackout}`
    if (menuKey === lastMenuKey) return
    lastMenuKey = menuKey

    tray.setToolTip(`CMSC Lighting Client\n${status.join('\n')}`)
    const template: Electron.MenuItemConstructorOptions[] = [
      { label: 'Show', click: show },
      { type: 'separator' },
      ...status.map((s) => ({ label: s, enabled: false })),
      { type: 'separator' },
      {
        label: latest.compositor.blackout ? 'Release blackout' : 'Blackout',
        // Read the current state at click time, not the state this menu was built with.
        click: () => services.setBlackout(!latest.compositor.blackout)
      },
      { label: 'Release all scenes', click: () => services.releaseAll() }
    ]
    if (latest.update.state === 'available' || latest.update.state === 'ready') {
      template.push(
        { type: 'separator' },
        {
          label:
            latest.update.state === 'ready'
              ? `Restart & install update (${latest.update.availableVersion})`
              : `Update available (${latest.update.availableVersion}) — open Settings`,
          click: show
        }
      )
    }
    template.push(
      { type: 'separator' },
      {
        label: 'Lighting mode',
        submenu: LIGHTING_MODES.map((m) => ({
          label: LIGHTING_MODE_INFO[m].label,
          type: 'radio' as const,
          checked: latest.lightingMode.mode === m,
          click: () => void setMode(m)
        }))
      },
      ...(latest.mappingGroup.groups.length
        ? [
            {
              label: 'Mapping group',
              submenu: latest.mappingGroup.groups.map((g) => ({
                label: g.name,
                type: 'radio' as const,
                checked: latest.mappingGroup.activeId === g.id,
                click: () => void services.setMappingGroup(g.id, 'tray')
              }))
            }
          ]
        : []),
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() }
    )
    tray.setContextMenu(Menu.buildFromTemplate(template))
  }

  rebuild(latest)
  services.on('snapshot', rebuild)
  tray.on('click', show)
  tray.on('double-click', show)
  return tray
}
