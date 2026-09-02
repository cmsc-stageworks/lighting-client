import { SerialPort } from 'serialport'
import type { EnttecOutput as EnttecConfig } from '@shared/types/config'
import type { OutputHealth, TestReport, TestStep } from '@shared/types/state'
import { DMX_CHANNELS } from '@shared/constants'
import { getLogger } from '../logging'
import { buildEnttecPacket } from './enttecPacket'
import { findPortBySerial } from './serialDevices'
import { friendlyErrorMessage, type OutputDriver } from './types'

const log = getLogger('enttec')

export class EnttecProOutput implements OutputDriver {
  readonly id: string
  readonly universe: number
  private port: SerialPort | null = null
  private state: OutputHealth = { state: 'disabled', fps: 0, lastSendAt: null }
  private readyToWrite = true
  private lastSendTimes: number[] = []
  private lastFrame: Uint8Array = new Uint8Array(DMX_CHANNELS + 1)
  private stopped = true
  private reopenTimer: ReturnType<typeof setTimeout> | null = null
  private minIntervalMs: number
  private lastWriteAt = 0

  constructor(private cfg: EnttecConfig) {
    this.id = cfg.id
    this.universe = cfg.universe
    this.minIntervalMs = 1000 / cfg.enttec.fps
  }

  health(): OutputHealth {
    const now = Date.now()
    while (this.lastSendTimes.length && this.lastSendTimes[0] < now - 2000)
      this.lastSendTimes.shift()
    return {
      ...this.state,
      fps: Math.round(this.lastSendTimes.length / 2),
      detail: this.port?.path
    }
  }

  async start(): Promise<void> {
    this.stopped = false
    this.state = { state: 'starting', fps: 0, lastSendAt: null }
    await this.open()
  }

  private async resolvePath(): Promise<string | null> {
    if (this.cfg.enttec.serialNumber) {
      const p = await findPortBySerial(this.cfg.enttec.serialNumber)
      if (p) return p
    }
    return this.cfg.enttec.portPath || null
  }

  private async open(): Promise<void> {
    if (this.stopped) return
    const path = await this.resolvePath()
    if (!path) {
      this.fail('Port not found — is the Enttec plugged in?')
      this.scheduleReopen()
      return
    }
    await new Promise<void>((resolve) => {
      const port = new SerialPort(
        { path, baudRate: 250000, dataBits: 8, stopBits: 2, parity: 'none', autoOpen: false },
        undefined
      )
      port.on('error', (err) => {
        log.warn(`port error on ${path}: ${err.message}`)
        this.fail(friendlyErrorMessage(err))
        this.closePort()
        this.scheduleReopen()
      })
      port.on('close', () => {
        if (this.stopped) return
        log.warn(`port ${path} closed unexpectedly`)
        this.fail('Port closed — device unplugged?')
        this.port = null
        this.scheduleReopen()
      })
      port.open((err) => {
        if (err) {
          this.fail(friendlyErrorMessage(err))
          this.scheduleReopen()
          resolve()
          return
        }
        this.port = port
        this.readyToWrite = true
        this.state = { state: 'ok', fps: 0, lastSendAt: null, detail: path }
        log.info(`opened ${path}`)
        resolve()
      })
    })
  }

  private fail(reason: string): void {
    this.state = { state: 'error', reason, fps: 0, lastSendAt: this.state.lastSendAt }
  }

  private scheduleReopen(): void {
    if (this.stopped || this.reopenTimer) return
    this.reopenTimer = setTimeout(() => {
      this.reopenTimer = null
      void this.open()
    }, 2000)
  }

  private closePort(): void {
    const p = this.port
    this.port = null
    if (p && p.isOpen) p.close(() => undefined)
  }

  async stop(): Promise<void> {
    this.stopped = true
    if (this.reopenTimer) clearTimeout(this.reopenTimer)
    this.reopenTimer = null
    await new Promise<void>((resolve) => {
      const p = this.port
      this.port = null
      if (p && p.isOpen) p.close(() => resolve())
      else resolve()
    })
    this.state = { state: 'disabled', fps: 0, lastSendAt: null }
  }

  deliver(frame: Uint8Array, _changed: boolean, now: number): void {
    this.lastFrame = frame
    // The Pro does not refresh on its own in every firmware, so send every tick like Thorium does.
    if (now - this.lastWriteAt < this.minIntervalMs - 1) return
    this.write(frame, now)
  }

  private write(frame: Uint8Array, now: number): void {
    const port = this.port
    if (!port || !port.isOpen || !this.readyToWrite) return
    this.readyToWrite = false
    this.lastWriteAt = now
    port.write(buildEnttecPacket(frame), (err) => {
      if (err) {
        this.fail(friendlyErrorMessage(err))
        this.readyToWrite = true
        return
      }
      port.drain(() => {
        this.readyToWrite = true
        this.lastSendTimes.push(Date.now())
        this.state.lastSendAt = Date.now()
        if (this.state.state !== 'ok')
          this.state = { ...this.state, state: 'ok', reason: undefined }
      })
    })
  }

  async sendZero(): Promise<void> {
    const port = this.port
    if (!port || !port.isOpen) return
    await new Promise<void>((resolve) => {
      port.write(buildEnttecPacket(new Uint8Array(DMX_CHANNELS + 1)), () =>
        port.drain(() => resolve())
      )
      setTimeout(resolve, 500)
    })
  }

  async test(): Promise<TestReport> {
    const started = Date.now()
    const steps: TestStep[] = []
    const path = await this.resolvePath()
    steps.push({ name: 'Locate serial port', ok: !!path, detail: path ?? 'not found' })
    if (!path) return { ok: false, steps, durationMs: Date.now() - started }
    const wasOpen = !!this.port?.isOpen
    if (wasOpen) {
      steps.push({ name: 'Port open', ok: true, detail: 'already open' })
      const ok = await new Promise<boolean>((resolve) => {
        this.port!.write(buildEnttecPacket(this.lastFrame), (err) => resolve(!err))
      })
      steps.push({
        name: 'Write frame',
        ok,
        detail: ok ? 'frame written and drained' : 'write failed'
      })
      return { ok, steps, durationMs: Date.now() - started }
    }
    const result = await new Promise<{ ok: boolean; detail: string }>((resolve) => {
      const port = new SerialPort({
        path,
        baudRate: 250000,
        dataBits: 8,
        stopBits: 2,
        parity: 'none',
        autoOpen: false
      })
      port.open((err) => {
        if (err) return resolve({ ok: false, detail: friendlyErrorMessage(err) })
        let n = 0
        const writeNext = (): void => {
          if (n++ >= 5) {
            port.close(() => resolve({ ok: true, detail: '5 frames written' }))
            return
          }
          port.write(buildEnttecPacket(new Uint8Array(DMX_CHANNELS + 1)), (werr) => {
            if (werr)
              return port.close(() => resolve({ ok: false, detail: friendlyErrorMessage(werr) }))
            port.drain(() => setTimeout(writeNext, 25))
          })
        }
        writeNext()
      })
    })
    steps.push({ name: 'Open and write 5 frames', ok: result.ok, detail: result.detail })
    return { ok: result.ok, steps, durationMs: Date.now() - started }
  }
}
