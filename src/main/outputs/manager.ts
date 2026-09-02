import { EventEmitter } from 'events'
import type { Output } from '@shared/types/config'
import type { OutputHealth, TestReport } from '@shared/types/state'
import { stableStringify } from '@shared/utils'
import { getLogger } from '../logging'
import { EnttecProOutput } from './enttecOutput'
import { SacnOutput } from './sacnOutput'
import type { OutputDriver } from './types'

const log = getLogger('outputs')

/** Zero every channel outside the configured range so a room instance can never write another ship's block. */
export function maskFrame(
  frame: Uint8Array,
  range: { from: number; to: number } | null
): Uint8Array {
  if (!range) return frame
  const out = new Uint8Array(frame.length)
  const from = Math.min(range.from, range.to)
  const to = Math.max(range.from, range.to)
  for (let ch = from; ch <= to && ch < frame.length; ch++) out[ch] = frame[ch]
  return out
}

interface Managed {
  cfg: Output
  hash: string
  driver: OutputDriver | null
  lastState: OutputHealth['state'] | null
}

/**
 * Creates/destroys drivers when the profile's outputs change and fans composited
 * frames out to every driver carrying a universe.
 */
export class OutputManager extends EventEmitter {
  private managed = new Map<string, Managed>()
  private lastFrames = new Map<string, Uint8Array>()

  constructor() {
    super()
  }

  universes(): number[] {
    const set = new Set<number>()
    for (const m of this.managed.values()) if (m.cfg.enabled) set.add(m.cfg.universe)
    return [...set].sort((a, b) => a - b)
  }

  maxFps(): number {
    let fps = 1
    for (const m of this.managed.values()) {
      if (!m.cfg.enabled) continue
      const f = m.cfg.driver === 'sacn' ? m.cfg.sacn.fps : m.cfg.enttec.fps
      fps = Math.max(fps, f)
    }
    return fps
  }

  async apply(outputs: Output[]): Promise<void> {
    const seen = new Set<string>()
    for (const cfg of outputs) {
      seen.add(cfg.id)
      const hash = stableStringify(cfg)
      const existing = this.managed.get(cfg.id)
      if (existing && existing.hash === hash) continue
      if (existing) await this.destroy(cfg.id)
      const m: Managed = { cfg, hash, driver: null, lastState: null }
      this.managed.set(cfg.id, m)
      if (cfg.enabled) await this.startDriver(m)
    }
    for (const id of [...this.managed.keys()]) if (!seen.has(id)) await this.destroy(id)
    this.emit('universesChanged', this.universes())
  }

  private async startDriver(m: Managed): Promise<void> {
    const driver = m.cfg.driver === 'sacn' ? new SacnOutput(m.cfg) : new EnttecProOutput(m.cfg)
    m.driver = driver
    try {
      await driver.start()
    } catch (err) {
      log.error(`failed to start output ${m.cfg.name}`, err)
    }
  }

  private async destroy(id: string): Promise<void> {
    const m = this.managed.get(id)
    if (!m) return
    this.managed.delete(id)
    if (m.driver) {
      try {
        await m.driver.stop()
      } catch (err) {
        log.warn(`error stopping output ${m.cfg.name}`, err)
      }
    }
  }

  async restart(id: string): Promise<void> {
    const m = this.managed.get(id)
    if (!m) return
    if (m.driver) await m.driver.stop()
    m.driver = null
    if (m.cfg.enabled) await this.startDriver(m)
  }

  async stopAll(): Promise<void> {
    for (const id of [...this.managed.keys()]) await this.destroy(id)
  }

  deliver(universe: number, frame: Uint8Array, changed: boolean, now: number): void {
    for (const m of this.managed.values()) {
      if (!m.driver || m.cfg.universe !== universe) continue
      m.driver.deliver(maskFrame(frame, m.cfg.channelRange), changed, now)
    }
  }

  /** Poll health; emits 'health' when any driver's state string changes. */
  health(): Record<string, OutputHealth> {
    const out: Record<string, OutputHealth> = {}
    let changed = false
    for (const m of this.managed.values()) {
      const h = m.driver
        ? m.driver.health()
        : { state: 'disabled' as const, fps: 0, lastSendAt: null }
      out[m.cfg.id] = h
      if (m.lastState !== h.state) {
        if (m.lastState !== null) {
          this.emit('stateChange', {
            id: m.cfg.id,
            name: m.cfg.name,
            from: m.lastState,
            to: h.state,
            reason: h.reason
          })
        }
        m.lastState = h.state
        changed = true
      }
    }
    if (changed) this.emit('health', out)
    return out
  }

  async test(id: string): Promise<TestReport> {
    const m = this.managed.get(id)
    if (!m)
      return {
        ok: false,
        steps: [{ name: 'Output', ok: false, detail: 'Output not found' }],
        durationMs: 0
      }
    if (!m.driver) {
      // Disabled output: build a temporary driver just for the test.
      const driver = m.cfg.driver === 'sacn' ? new SacnOutput(m.cfg) : new EnttecProOutput(m.cfg)
      return driver.test()
    }
    return m.driver.test()
  }

  async sendZeroAll(): Promise<void> {
    await Promise.all(
      [...this.managed.values()].map((m) => m.driver?.sendZero().catch(() => undefined))
    )
  }

  configFor(id: string): Output | undefined {
    return this.managed.get(id)?.cfg
  }

  get lastFrameCache(): Map<string, Uint8Array> {
    return this.lastFrames
  }
}
