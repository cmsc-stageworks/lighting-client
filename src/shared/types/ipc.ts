import type { AppConfig, AppSettings, Profile } from '../schema/config.schema'
import type { AppEvent, MqttMessageRecord } from './events'
import type {
  ImportPreview,
  MqttTestReport,
  NetworkInterfaceInfo,
  ReferenceData,
  RuntimeSnapshot,
  SerialDeviceInfo,
  SimulateReport,
  ThoriumProbeResult,
  TestReport,
  ThoriumTestReport
} from './state'

/**
 * Request/response IPC surface. Every key is an `ipcMain.handle` channel and the
 * function type is what `window.api.invoke(channel, ...args)` resolves to.
 */
export interface IpcApi {
  'config.get': () => AppConfig
  'config.saveProfile': (profile: Profile) => { ok: true } | { ok: false; errors: string[] }
  'config.saveSettings': (settings: AppSettings) => void
  'config.setActiveProfile': (id: string) => void
  'config.createProfile': (name: string, kind: Profile['kind']) => Profile
  'config.deleteProfile': (id: string) => void
  'config.export': (what: 'all' | 'partial') => { path: string } | null
  'config.importPreview': () => ImportPreview | null
  'config.importApply': (token: string) => { ok: boolean; errors?: string[] }
  'config.listBackups': () => { path: string; ts: number; size: number }[]
  'config.restoreBackup': (path: string) => { ok: boolean; errors?: string[] }
  'secrets.set': (id: string | null, value: string) => string
  'secrets.has': (id: string) => boolean
  'secrets.available': () => boolean

  'runtime.getSnapshot': () => RuntimeSnapshot
  'events.getRecent': (limit: number) => AppEvent[]
  'events.clear': () => void

  'scene.activate': (sceneId: string, simulatorName: string | null, layerId?: string | null) => void
  'scene.release': (sceneId: string, simulatorName: string | null) => void
  'compositor.releaseAll': () => void
  'compositor.releaseLayer': (layerId: string) => void
  'compositor.setBlackout': (on: boolean) => void
  'compositor.setGrandMaster': (value: number) => void
  'dmx.subscribeUniverse': (universe: number, on: boolean) => void
  'dmx.setTestChannel': (universe: number, channel: number, value: number | null) => void
  'dmx.clearTest': () => void
  'dmx.getUniverses': () => number[]
  'dmx.getFrame': (universe: number) => { values: number[]; owners: (string | null)[] }

  'outputs.listSerialDevices': () => SerialDeviceInfo[]
  'outputs.listInterfaces': () => NetworkInterfaceInfo[]
  'outputs.test': (outputId: string) => TestReport
  'outputs.identify': (outputId: string, channel: number) => void
  'outputs.restart': (outputId: string) => void

  'thorium.test': () => ThoriumTestReport
  'thorium.probe': (host: string, port: number, secure: boolean) => ThoriumProbeResult
  'thorium.getReferenceData': () => ReferenceData
  'thorium.refreshReferenceData': () => ReferenceData
  'thorium.setAlertOverride': (simulatorName: string, level: string | null) => void
  'thorium.reconnect': () => void

  'mqtt.test': () => MqttTestReport
  'mqtt.publish': (topic: string, payload: string, qos: 0 | 1 | 2, retain: boolean) => void
  'mqtt.getRecentMessages': (limit: number) => MqttMessageRecord[]
  'mqtt.reconnect': () => void

  'mappings.simulate': (
    event: {
      type: string
      name: string
      simulatorName: string | null
      data: Record<string, unknown>
    },
    live: boolean
  ) => SimulateReport

  'app.openLogs': () => void
  'app.copyDiagnostics': () => string
  'app.getVersions': () => {
    app: string
    electron: string
    node: string
    chrome: string
    platform: string
  }
  'app.verifyPin': (pin: string) => boolean
  'app.setPin': (pin: string | null) => void
  'app.setLaunchAtLogin': (on: boolean) => void
  'app.quit': () => void
  'app.minimizeToTray': () => void
}

export type IpcChannel = keyof IpcApi
export type IpcArgs<C extends IpcChannel> = Parameters<IpcApi[C]>
export type IpcResult<C extends IpcChannel> = ReturnType<IpcApi[C]>

/** Main → renderer pushes. */
export interface IpcPush {
  'state:snapshot': RuntimeSnapshot
  'config:changed': AppConfig
  'events:batch': AppEvent[]
  'dmx:frame': { universe: number; values: number[]; owners: (string | null)[] }
  'mqtt:message': MqttMessageRecord
  toast: { level: 'info' | 'warn' | 'error' | 'success'; message: string }
  'refdata:changed': ReferenceData
}
export type IpcPushChannel = keyof IpcPush

export interface RendererApi {
  invoke<C extends IpcChannel>(channel: C, ...args: IpcArgs<C>): Promise<Awaited<IpcResult<C>>>
  on<C extends IpcPushChannel>(channel: C, listener: (payload: IpcPush[C]) => void): () => void
}
