import { contextBridge, ipcRenderer } from 'electron'
import type { RendererApi } from '@shared/types/ipc'

const PUSH_CHANNELS = new Set([
  'state:snapshot',
  'config:changed',
  'events:batch',
  'dmx:frame',
  'mqtt:message',
  'toast',
  'refdata:changed'
])

const api: RendererApi = {
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  on: (channel, listener) => {
    if (!PUSH_CHANNELS.has(channel)) throw new Error(`Unknown push channel ${channel}`)
    const wrapped = (_e: Electron.IpcRendererEvent, payload: unknown): void =>
      listener(payload as never)
    ipcRenderer.on(channel, wrapped)
    return () => ipcRenderer.off(channel, wrapped)
  }
}

contextBridge.exposeInMainWorld('api', api)
