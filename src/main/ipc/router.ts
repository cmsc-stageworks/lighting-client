import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron'
import { createHash, randomBytes } from 'crypto'
import { promises as fs } from 'fs'
import { z } from 'zod'
import type { IpcApi, IpcChannel, IpcPush, IpcPushChannel } from '@shared/types/ipc'
import { AppSettingsSchema } from '@shared/schema/config.schema'
import type { AppEvent } from '@shared/types/events'
import type { ImportPreview } from '@shared/types/state'
import { DMX_CHANNELS } from '@shared/constants'
import { logsDirectory, tailLog } from '../logging'
import { listNetworkInterfaces, listSerialDevices } from '../outputs/serialDevices'
import type { Services } from '../services'
import { probeThorium } from '../sources/thorium/adapter'
import { setLaunchAtLogin } from '../app/lifecycle'

type Handler<C extends IpcChannel> = (
  ...args: Parameters<IpcApi[C]>
) => ReturnType<IpcApi[C]> | Promise<Awaited<ReturnType<IpcApi[C]>>>

/** Pending import previews keyed by token (consumed by importApply). */
const importPreviews = new Map<string, { kind: 'all' | 'partial'; text: string }>()

export function registerIpc(services: Services, getWindow: () => BrowserWindow | null): void {
  const handle = <C extends IpcChannel>(
    channel: C,
    schema: z.ZodTypeAny | null,
    fn: Handler<C>
  ): void => {
    ipcMain.handle(channel, async (_e, ...args: unknown[]) => {
      if (schema) {
        const r = schema.safeParse(args)
        if (!r.success)
          throw new Error(
            `Invalid arguments for ${channel}: ${r.error.issues.map((i) => i.message).join('; ')}`
          )
      }
      return (fn as (...a: unknown[]) => unknown)(...args)
    })
  }

  const s = services
  const str = z.string()
  const num = z.number()

  // ---------------------------------------------------------------- config
  handle('config.get', null, () => s.store.get())
  // Validation happens in the store so the renderer gets a readable error list instead of a thrown IPC error.
  handle('config.saveProfile', null, (profile) => s.store.saveProfile(profile))
  handle('config.saveSettings', z.tuple([AppSettingsSchema]), (settings) =>
    s.store.saveSettings(settings)
  )
  handle('config.setActiveProfile', z.tuple([str]), (id) => s.store.setActiveProfile(id))
  handle('config.createProfile', z.tuple([str, z.enum(['central', 'single-ship'])]), (name, kind) =>
    s.store.createProfile(name, kind)
  )
  handle('config.deleteProfile', z.tuple([str]), (id) => s.store.deleteProfile(id))
  handle('config.export', z.tuple([z.enum(['all', 'partial'])]), async (what) => {
    const win = getWindow()
    const opts: Electron.SaveDialogOptions = {
      title:
        what === 'all'
          ? 'Export full configuration'
          : 'Export scenes, mappings, simulators and layers',
      defaultPath:
        what === 'all'
          ? 'cmsc-lighting-config.json'
          : `cmsc-lighting-${s.store.active().name.toLowerCase().replace(/\s+/g, '-')}-partial.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    }
    const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (res.canceled || !res.filePath) return null
    await fs.writeFile(
      res.filePath,
      what === 'all' ? s.store.exportAll() : s.store.exportPartial(),
      'utf8'
    )
    return { path: res.filePath }
  })
  handle('config.importPreview', null, async () => {
    const win = getWindow()
    const opts: Electron.OpenDialogOptions = {
      title: 'Import configuration',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (res.canceled || !res.filePaths[0]) return null
    const text = await fs.readFile(res.filePaths[0], 'utf8')
    const preview = s.store.previewImport(text)
    const token = randomBytes(8).toString('hex')
    importPreviews.set(token, { kind: preview.kind, text })
    const out: ImportPreview =
      preview.kind === 'all'
        ? {
            token,
            kind: 'all',
            summary: { added: { profiles: preview.config.profiles.length }, updated: {} },
            warnings: ['Importing a full configuration replaces ALL profiles and settings.']
          }
        : { token, kind: 'partial', summary: preview.summary, warnings: preview.warnings }
    return out
  })
  handle('config.importApply', z.tuple([str]), async (token) => {
    const p = importPreviews.get(token)
    if (!p) return { ok: false, errors: ['Import preview expired; choose the file again'] }
    importPreviews.delete(token)
    try {
      const preview = s.store.previewImport(p.text)
      if (preview.kind === 'all') {
        await s.store.applyImportAll(preview.config)
        return { ok: true }
      }
      const errors = await s.store.applyImportPartial(preview.partial)
      return { ok: errors.length === 0, errors }
    } catch (err) {
      return { ok: false, errors: [(err as Error).message] }
    }
  })
  handle('config.listBackups', null, () => s.store.listBackups())
  handle('config.restoreBackup', z.tuple([str]), async (path) => {
    try {
      const errors = await s.store.restoreBackup(path)
      return { ok: errors.length === 0, errors }
    } catch (err) {
      return { ok: false, errors: [(err as Error).message] }
    }
  })
  handle('secrets.set', z.tuple([str.nullable(), str]), (id, value) => s.secrets.set(id, value))
  handle('secrets.has', z.tuple([str]), (id) => s.secrets.has(id))
  handle('secrets.available', null, () => s.secrets.available())

  // ---------------------------------------------------------------- runtime / events
  handle('runtime.getSnapshot', null, () => s.snapshot())
  handle('events.getRecent', z.tuple([num]), (limit) => s.log.recent(limit))
  handle('events.clear', null, () => s.log.clear())

  // ---------------------------------------------------------------- scenes / compositor
  handle(
    'scene.activate',
    z.tuple([str, str.nullable(), str.nullable().optional()]),
    (sceneId, simName, layerId) => s.activateSceneByUser(sceneId, simName, layerId ?? null)
  )
  handle('scene.release', z.tuple([str, str.nullable()]), (sceneId, simName) =>
    s.releaseSceneByUser(sceneId, simName)
  )
  handle('compositor.releaseAll', null, () => s.releaseAll())
  handle(
    'compositor.releaseLayer',
    z.tuple([str]),
    (layerId) => void s.compositor.releaseLayer(layerId)
  )
  handle('compositor.setBlackout', z.tuple([z.boolean()]), (on) => s.setBlackout(on))
  handle('compositor.setGrandMaster', z.tuple([num.min(0).max(1)]), (v) => s.setGrandMaster(v))
  handle('dmx.subscribeUniverse', z.tuple([num.int().min(1), z.boolean()]), (u, on) =>
    s.subscribeUniverse(u, on)
  )
  handle(
    'dmx.setTestChannel',
    z.tuple([
      num.int().min(1),
      num.int().min(1).max(DMX_CHANNELS),
      num.int().min(0).max(255).nullable()
    ]),
    (u, ch, v) => s.compositor.setTestChannel(u, ch, v)
  )
  handle('dmx.clearTest', null, () => s.compositor.clearTest())
  handle('dmx.getUniverses', null, () => s.compositor.universes())
  handle('dmx.getFrame', z.tuple([num.int().min(1)]), (u) => {
    const f = s.compositor.frame(u)
    return { values: Array.from(f.values.subarray(1)), owners: f.owners.slice(1) }
  })

  // ---------------------------------------------------------------- outputs
  handle('outputs.listSerialDevices', null, () => listSerialDevices())
  handle('outputs.listInterfaces', null, () => listNetworkInterfaces())
  handle('outputs.test', z.tuple([str]), (id) => s.outputs.test(id))
  handle(
    'outputs.identify',
    z.tuple([str, num.int().min(1).max(DMX_CHANNELS)]),
    async (id, channel) => {
      const cfg = s.outputs.configFor(id)
      if (!cfg) return
      let on = true
      for (let i = 0; i < 6; i++) {
        s.compositor.setTestChannel(cfg.universe, channel, on ? 255 : 0)
        on = !on
        await new Promise((r) => setTimeout(r, 500))
      }
      s.compositor.setTestChannel(cfg.universe, channel, null)
    }
  )
  handle('outputs.restart', z.tuple([str]), (id) => s.outputs.restart(id))

  // ---------------------------------------------------------------- thorium
  handle('thorium.test', null, () => s.thorium.test())
  handle(
    'thorium.probe',
    z.tuple([str, num.int().min(1).max(65535), z.boolean()]),
    (host, port, secure) => probeThorium(host, port, secure)
  )
  handle('thorium.getReferenceData', null, () => ({
    ...s.thorium.referenceData(),
    seenEventNames: s.log.seenEventNames()
  }))
  handle('thorium.refreshReferenceData', null, async () => {
    const r = await s.thorium.refreshReferenceData()
    return { ...r, seenEventNames: s.log.seenEventNames() }
  })
  handle('thorium.setAlertOverride', z.tuple([str, str.nullable()]), (name, level) =>
    s.setAlertOverride(name, level)
  )
  handle('thorium.reconnect', null, () => s.thorium.reconnect())

  // ---------------------------------------------------------------- mqtt
  handle('mqtt.test', null, () => s.mqtt.test())
  handle(
    'mqtt.publish',
    z.tuple([str, str, z.union([z.literal(0), z.literal(1), z.literal(2)]), z.boolean()]),
    (t, p, q, r) => s.mqtt.publish(t, p, q, r)
  )
  handle('mqtt.getRecentMessages', z.tuple([num]), (limit) => s.mqtt.recentMessages(limit))
  handle('mqtt.reconnect', null, () => s.mqtt.reconnect())

  // ---------------------------------------------------------------- mappings
  handle(
    'mappings.simulate',
    z.tuple([
      z.object({
        type: str,
        name: str,
        simulatorName: str.nullable(),
        data: z.record(str, z.unknown())
      }),
      z.boolean()
    ]),
    (ev, live) => s.simulate(ev, live)
  )

  // ---------------------------------------------------------------- app
  handle('app.openLogs', null, () => void shell.openPath(logsDirectory()))
  handle('app.copyDiagnostics', null, async () => {
    const text = await s.diagnostics(versions(), await tailLog(200))
    clipboard.writeText(text)
    return text
  })
  handle('app.getVersions', null, () => versions())
  handle('app.verifyPin', z.tuple([str]), (pin) => {
    const hash = s.store.settings().setupPinHash
    if (!hash) return true
    return hashPin(pin, hash.split(':')[0]) === hash
  })
  handle('app.setPin', z.tuple([str.nullable()]), async (pin) => {
    if (pin == null || pin === '') return s.store.patchSettings({ setupPinHash: null })
    const salt = randomBytes(8).toString('hex')
    await s.store.patchSettings({ setupPinHash: hashPin(pin, salt) })
  })
  handle('app.setLaunchAtLogin', z.tuple([z.boolean()]), async (on) => {
    setLaunchAtLogin(on, s.store.settings().startMinimized)
    await s.store.patchSettings({ launchAtLogin: on })
  })
  handle('app.quit', null, () => app.quit())
  handle('app.minimizeToTray', null, () => getWindow()?.hide())
}

export function hashPin(pin: string, salt: string): string {
  return `${salt}:${createHash('sha256').update(`${salt}:${pin}`).digest('hex')}`
}

function versions(): {
  app: string
  electron: string
  node: string
  chrome: string
  platform: string
} {
  return {
    app: app.getVersion(),
    electron: process.versions.electron ?? '',
    node: process.versions.node,
    chrome: process.versions.chrome ?? '',
    platform: `${process.platform} ${process.arch}`
  }
}

/** Wire main → renderer pushes. */
export function bindPushes(services: Services, getWindow: () => BrowserWindow | null): void {
  const push = <C extends IpcPushChannel>(channel: C, payload: IpcPush[C]): void => {
    const w = getWindow()
    if (w && !w.isDestroyed()) w.webContents.send(channel, payload)
  }
  services.on('snapshot', (snap) => push('state:snapshot', snap))
  services.on('events', (batch: AppEvent[]) => push('events:batch', batch))
  services.on('frame', (f) => push('dmx:frame', f))
  services.on('toast', (t) => push('toast', t))
  services.on('refdata', (r) =>
    push('refdata:changed', { ...r, seenEventNames: services.log.seenEventNames() })
  )
  services.on('mqttMessage', (m) => push('mqtt:message', m))
  services.store.on('change', () => push('config:changed', services.store.get()))
}
