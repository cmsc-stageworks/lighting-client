import { Receiver, Sender } from 'sacn'
import type { SacnOutput as SacnConfig } from '@shared/types/config'
import type { OutputHealth, TestReport, TestStep } from '@shared/types/state'
import { DMX_CHANNELS } from '@shared/constants'
import { getLogger } from '../logging'
import { friendlyErrorMessage, type OutputDriver } from './types'

const log = getLogger('sacn')

async function listenForOtherSources(
  universe: number,
  ownSourceName: string,
  iface: string | null
): Promise<{ name: string; address: string; priority: number }[] | null> {
  return new Promise((resolve) => {
    let receiver: Receiver | null = null
    const found = new Map<string, { name: string; address: string; priority: number }>()
    const done = (result: typeof found | null): void => {
      try {
        receiver?.close()
      } catch {
        /* ignore */
      }
      resolve(result ? [...result.values()] : null)
    }
    try {
      receiver = new Receiver({ universes: [universe], reuseAddr: true, iface: iface ?? undefined })
      receiver.on('packet', (p) => {
        if (p.sourceName === ownSourceName) return
        const key = `${p.sourceName}|${p.sourceAddress ?? ''}`
        if (!found.has(key))
          found.set(key, {
            name: p.sourceName,
            address: p.sourceAddress ?? '?',
            priority: p.priority
          })
      })
      receiver.on('error', () => done(null))
      setTimeout(() => done(found), 2000)
    } catch {
      done(null)
    }
  })
}

function toPayload(frame: Uint8Array): Record<number, number> {
  const payload: Record<number, number> = {}
  for (let i = 1; i <= DMX_CHANNELS; i++) payload[i] = frame[i] ?? 0
  return payload
}

export class SacnOutput implements OutputDriver {
  readonly id: string
  readonly universe: number
  private sender: Sender | null = null
  private state: OutputHealth = { state: 'disabled', fps: 0, lastSendAt: null }
  private lastSendTimes: number[] = []
  private lastSentAt = 0
  private lastFrame: Uint8Array = new Uint8Array(DMX_CHANNELS + 1)
  private minIntervalMs: number
  private stopped = true
  private restartTimer: ReturnType<typeof setTimeout> | null = null
  private backoffMs = 1000
  private sending = false

  constructor(private cfg: SacnConfig) {
    this.id = cfg.id
    this.universe = cfg.universe
    this.minIntervalMs = 1000 / cfg.sacn.fps
  }

  health(): OutputHealth {
    const now = Date.now()
    while (this.lastSendTimes.length && this.lastSendTimes[0] < now - 2000)
      this.lastSendTimes.shift()
    const dest =
      this.cfg.sacn.mode === 'unicast'
        ? (this.cfg.sacn.unicastAddress ?? '')
        : `multicast 239.255.${(this.universe >> 8) & 0xff}.${this.universe & 0xff}`
    return {
      ...this.state,
      fps: Math.round(this.lastSendTimes.length / 2),
      detail: `${dest}${this.cfg.sacn.iface ? ' via ' + this.cfg.sacn.iface : ''}`
    }
  }

  private createSender(): Sender {
    const s = new Sender({
      universe: this.universe,
      reuseAddr: true,
      // Keep-alive is driven by deliver() below so the achieved rate is observable.
      minRefreshRate: 0,
      iface: this.cfg.sacn.iface ?? undefined,
      useUnicastDestination:
        this.cfg.sacn.mode === 'unicast' ? (this.cfg.sacn.unicastAddress ?? undefined) : undefined,
      defaultPacketOptions: {
        sourceName: this.cfg.sacn.sourceName,
        priority: this.cfg.sacn.priority,
        useRawDmxValues: true
      }
    })
    s.on('error', (err) => {
      log.warn(`sender error U${this.universe}: ${err.message}`)
      this.state = { ...this.state, state: 'error', reason: friendlyErrorMessage(err) }
      this.scheduleRestart()
    })
    return s
  }

  async start(): Promise<void> {
    this.stopped = false
    this.state = { state: 'starting', fps: 0, lastSendAt: null }
    try {
      this.sender = this.createSender()
      // Send an initial frame so the receiver sees the source immediately.
      await this.sender.send({ payload: toPayload(this.lastFrame) })
      this.state = { state: 'ok', fps: 0, lastSendAt: Date.now() }
      this.backoffMs = 1000
      log.info(`started universe ${this.universe} (${this.cfg.sacn.mode})`)
    } catch (err) {
      this.state = { state: 'error', reason: friendlyErrorMessage(err), fps: 0, lastSendAt: null }
      this.scheduleRestart()
    }
  }

  private scheduleRestart(): void {
    if (this.stopped || this.restartTimer) return
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      this.closeSender()
      void this.start()
    }, this.backoffMs)
    this.backoffMs = Math.min(30000, this.backoffMs * 2)
  }

  private closeSender(): void {
    try {
      this.sender?.close()
    } catch {
      /* ignore */
    }
    this.sender = null
  }

  async stop(): Promise<void> {
    this.stopped = true
    if (this.restartTimer) clearTimeout(this.restartTimer)
    this.restartTimer = null
    this.closeSender()
    this.state = { state: 'disabled', fps: 0, lastSendAt: null }
  }

  deliver(frame: Uint8Array, changed: boolean, now: number): void {
    this.lastFrame = frame
    if (!this.sender || this.state.state === 'error') return
    // Send on change (rate-limited) and otherwise as a keep-alive so receivers never time out.
    if (!changed && now - this.lastSentAt < this.cfg.sacn.keepAliveMs) return
    if (changed && now - this.lastSentAt < this.minIntervalMs - 1) return
    if (this.sending) return
    this.lastSentAt = now
    this.sending = true
    this.sender
      .send({ payload: toPayload(frame) })
      .then(() => {
        this.lastSendTimes.push(Date.now())
        this.state.lastSendAt = Date.now()
        if (this.state.state !== 'ok')
          this.state = { ...this.state, state: 'ok', reason: undefined }
      })
      .catch((err) => {
        this.state = { ...this.state, state: 'error', reason: friendlyErrorMessage(err) }
        this.scheduleRestart()
      })
      .finally(() => {
        this.sending = false
      })
  }

  async sendZero(): Promise<void> {
    if (!this.sender) return
    try {
      await this.sender.send({ payload: toPayload(new Uint8Array(DMX_CHANNELS + 1)) })
    } catch {
      /* ignore */
    }
  }

  async test(): Promise<TestReport> {
    const started = Date.now()
    const steps: TestStep[] = []
    if (this.cfg.sacn.mode === 'unicast' && !this.cfg.sacn.unicastAddress) {
      steps.push({ name: 'Configuration', ok: false, detail: 'Unicast mode needs an address' })
      return { ok: false, steps, durationMs: Date.now() - started }
    }
    steps.push({
      name: 'Configuration',
      ok: true,
      detail: `${this.cfg.sacn.mode}, universe ${this.universe}, priority ${this.cfg.sacn.priority}`
    })
    // Listen briefly for OTHER senders on this universe: Mosaic prefers 1–2 sources per universe
    // and several lighting clients on one universe would compete.
    const others = await listenForOtherSources(
      this.universe,
      this.cfg.sacn.sourceName,
      this.cfg.sacn.iface
    )
    if (others === null) {
      steps.push({
        name: 'Other sACN sources on this universe',
        ok: true,
        detail: 'could not listen (multicast receive unavailable on this interface)'
      })
    } else {
      steps.push({
        name: 'Other sACN sources on this universe',
        ok: others.length === 0,
        detail: others.length
          ? `${others.length} other sender(s): ${others.map((o) => `${o.name} @ ${o.address} (prio ${o.priority})`).join(', ')} — multiple senders on one universe will conflict`
          : 'none heard in 2 s'
      })
    }
    let sender: Sender | null = null
    try {
      sender = new Sender({
        universe: this.universe,
        reuseAddr: true,
        iface: this.cfg.sacn.iface ?? undefined,
        useUnicastDestination:
          this.cfg.sacn.mode === 'unicast'
            ? (this.cfg.sacn.unicastAddress ?? undefined)
            : undefined,
        defaultPacketOptions: {
          sourceName: this.cfg.sacn.sourceName,
          priority: this.cfg.sacn.priority,
          useRawDmxValues: true
        }
      })
      const errors: string[] = []
      sender.on('error', (e) => errors.push(e.message))
      steps.push({
        name: 'Bind socket',
        ok: true,
        detail: this.cfg.sacn.iface ? `interface ${this.cfg.sacn.iface}` : 'default interface'
      })
      for (let i = 0; i < 10; i++) {
        await sender.send({ payload: toPayload(this.lastFrame) })
        await new Promise((r) => setTimeout(r, 25))
      }
      const ok = errors.length === 0
      steps.push({
        name: 'Send 10 frames',
        ok,
        detail: ok ? 'no socket errors' : errors.join('; ')
      })
      return { ok, steps, durationMs: Date.now() - started }
    } catch (err) {
      steps.push({ name: 'Send frames', ok: false, detail: friendlyErrorMessage(err) })
      return { ok: false, steps, durationMs: Date.now() - started }
    } finally {
      try {
        sender?.close()
      } catch {
        /* ignore */
      }
    }
  }
}
