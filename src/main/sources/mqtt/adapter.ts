import { EventEmitter } from 'events'
import mqtt, { type MqttClient } from 'mqtt'
import type { MqttSettings } from '@shared/types/config'
import type { MqttMessageRecord } from '@shared/types/events'
import type { MqttRuntime, MqttTestReport } from '@shared/types/state'
import { MQTT_RECENT_MESSAGES } from '@shared/constants'
import { mqttTopicMatches } from '@shared/utils'
import type { EventBus } from '../../core/eventBus'
import { getLogger } from '../../logging'

const log = getLogger('mqtt')

export interface MqttAdapterDeps {
  bus: EventBus
  getPassword: (secretId: string | null) => string | null
  instanceName: () => string
  onCommand: (payload: unknown, topic: string) => void
}

export class MqttAdapter extends EventEmitter {
  private settings: MqttSettings
  private client: MqttClient | null = null
  private state: MqttRuntime = {
    state: 'disabled',
    subscriptions: [],
    messagesPerSec: 0,
    reconnects: 0
  }
  private counts = new Map<string, number>()
  private recent: MqttMessageRecord[] = []
  private msgTimes: number[] = []
  private reconnects = 0

  constructor(
    settings: MqttSettings,
    private deps: MqttAdapterDeps
  ) {
    super()
    this.settings = settings
  }

  baseTopic(): string {
    return this.settings.publish.baseTopic
      .replace('{instanceName}', this.deps.instanceName())
      .replace(/\/+$/, '')
  }

  runtime(): MqttRuntime {
    const now = Date.now()
    while (this.msgTimes.length && this.msgTimes[0] < now - 5000) this.msgTimes.shift()
    return {
      ...this.state,
      subscriptions: this.settings.subscriptions
        .filter((s) => s.enabled)
        .map((s) => ({ topic: s.topic, count: this.counts.get(s.topic) ?? 0 })),
      messagesPerSec: Math.round((this.msgTimes.length / 5) * 10) / 10,
      reconnects: this.reconnects
    }
  }

  isConnected(): boolean {
    return !!this.client?.connected
  }

  recentMessages(limit: number): MqttMessageRecord[] {
    return this.recent.slice(Math.max(0, this.recent.length - limit))
  }

  private setState(patch: Partial<MqttRuntime>): void {
    this.state = { ...this.state, ...patch }
    this.emit('state', this.runtime())
  }

  start(): void {
    if (!this.settings.enabled) {
      this.setState({ state: 'disabled', reason: undefined })
      return
    }
    this.setState({ state: 'connecting', reason: undefined })
    const willTopic = `${this.baseTopic()}/status`
    let client: MqttClient
    try {
      client = mqtt.connect(this.settings.url, {
        clientId: this.settings.clientId,
        username: this.settings.username ?? undefined,
        password: this.deps.getPassword(this.settings.passwordSecretId) ?? undefined,
        keepalive: this.settings.keepalive,
        clean: this.settings.cleanSession,
        rejectUnauthorized: this.settings.rejectUnauthorized,
        reconnectPeriod: 2000,
        connectTimeout: 10000,
        will: this.settings.publish.enabled
          ? {
              topic: willTopic,
              payload: Buffer.from(JSON.stringify({ online: false })),
              qos: this.settings.publish.qos,
              retain: true
            }
          : undefined
      })
    } catch (err) {
      this.setState({ state: 'error', reason: (err as Error).message })
      return
    }
    this.client = client
    client.on('connect', () => {
      log.info(`connected to ${this.settings.url}`)
      this.setState({ state: 'connected', reason: undefined, connectedSince: Date.now() })
      this.subscribeAll()
      this.deps.bus.emit({
        source: 'system',
        type: 'system',
        name: 'mqtt.connected',
        data: { url: this.settings.url }
      })
      this.emit('connected')
    })
    client.on('reconnect', () => {
      this.reconnects++
      if (this.state.state === 'connected')
        this.setState({ state: 'reconnecting', connectedSince: null })
    })
    client.on('close', () => {
      if (this.state.state === 'connected') {
        this.setState({ state: 'reconnecting', reason: 'connection closed', connectedSince: null })
        this.deps.bus.emit({
          source: 'system',
          type: 'system',
          name: 'mqtt.disconnected',
          data: {}
        })
      }
    })
    client.on('error', (err) => {
      log.warn(`error: ${err.message}`)
      this.setState({ state: this.client?.connected ? 'connected' : 'error', reason: err.message })
    })
    client.on('message', (topic, payload, packet) =>
      this.onMessage(topic, payload.toString('utf8'), packet.qos, !!packet.retain)
    )
  }

  private subscribeAll(): void {
    const c = this.client
    if (!c) return
    const topics = this.settings.subscriptions
      .filter((s) => s.enabled)
      .map((s) => ({ topic: s.topic, qos: s.qos }))
    if (this.settings.publish.enabled && this.settings.publish.commandTopic)
      topics.push({ topic: `${this.baseTopic()}/cmd`, qos: this.settings.publish.qos })
    for (const t of topics) {
      c.subscribe(t.topic, { qos: t.qos }, (err) => {
        if (err) log.warn(`subscribe ${t.topic} failed: ${err.message}`)
      })
    }
  }

  private onMessage(topic: string, payload: string, qos: number, retain: boolean): void {
    this.msgTimes.push(Date.now())
    const rec: MqttMessageRecord = { ts: Date.now(), topic, payload, qos, retain }
    this.recent.push(rec)
    if (this.recent.length > MQTT_RECENT_MESSAGES) this.recent.shift()
    this.emit('message', rec)
    for (const s of this.settings.subscriptions)
      if (s.enabled && mqttTopicMatches(s.topic, topic))
        this.counts.set(s.topic, (this.counts.get(s.topic) ?? 0) + 1)
    let json: unknown = undefined
    const trimmed = payload.trim()
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        json = JSON.parse(trimmed)
      } catch {
        json = undefined
      }
    }
    const cmdTopic = `${this.baseTopic()}/cmd`
    if (this.settings.publish.enabled && this.settings.publish.commandTopic && topic === cmdTopic) {
      this.deps.onCommand(json ?? payload, topic)
    }
    this.deps.bus.emit({
      source: 'mqtt',
      type: 'mqtt.message',
      name: topic,
      data: { topic, topicMatch: topic, payload, json, qos, retain }
    })
  }

  publish(topic: string, payload: string | Buffer, qos: 0 | 1 | 2 = 0, retain = false): void {
    const c = this.client
    if (!c || !c.connected) return
    c.publish(topic, payload, { qos, retain }, (err) => {
      if (err) log.warn(`publish ${topic} failed: ${err.message}`)
    })
  }

  async stop(publishOffline = true): Promise<void> {
    const c = this.client
    this.client = null
    if (c) {
      if (publishOffline && c.connected && this.settings.publish.enabled) {
        await new Promise<void>((resolve) =>
          c.publish(
            `${this.baseTopic()}/status`,
            JSON.stringify({ online: false }),
            { qos: this.settings.publish.qos, retain: true },
            () => resolve()
          )
        )
      }
      await new Promise<void>((resolve) => c.end(false, {}, () => resolve()))
    }
    this.setState({ state: 'disabled', connectedSince: null })
  }

  async updateSettings(next: MqttSettings): Promise<void> {
    const prev = this.settings
    this.settings = next
    const connChanged =
      [
        'enabled',
        'url',
        'clientId',
        'username',
        'passwordSecretId',
        'keepalive',
        'cleanSession',
        'rejectUnauthorized'
      ].some(
        (k) => (prev as Record<string, unknown>)[k] !== (next as Record<string, unknown>)[k]
      ) || prev.publish.baseTopic !== next.publish.baseTopic
    if (connChanged) {
      await this.stop()
      this.start()
      return
    }
    const c = this.client
    if (c?.connected) {
      const prevTopics = new Set(prev.subscriptions.filter((s) => s.enabled).map((s) => s.topic))
      const nextTopics = new Set(next.subscriptions.filter((s) => s.enabled).map((s) => s.topic))
      for (const t of prevTopics) if (!nextTopics.has(t)) c.unsubscribe(t)
      for (const t of nextTopics)
        if (!prevTopics.has(t))
          c.subscribe(t, { qos: next.subscriptions.find((s) => s.topic === t)?.qos ?? 0 })
      const cmd = `${this.baseTopic()}/cmd`
      if (prev.publish.commandTopic && !next.publish.commandTopic) c.unsubscribe(cmd)
      if (!prev.publish.commandTopic && next.publish.commandTopic)
        c.subscribe(cmd, { qos: next.publish.qos })
    }
  }

  reconnect(): void {
    if (!this.settings.enabled) return
    void this.stop(false).then(() => this.start())
  }

  async test(): Promise<MqttTestReport> {
    const started = Date.now()
    const steps: MqttTestReport['steps'] = []
    const report: MqttTestReport = { ok: false, steps, durationMs: 0, broker: this.settings.url }
    const result = await new Promise<{ ok: boolean; detail: string }>((resolve) => {
      let c: MqttClient | null = null
      const done = (ok: boolean, detail: string): void => {
        try {
          c?.end(true)
        } catch {
          /* ignore */
        }
        resolve({ ok, detail })
      }
      try {
        c = mqtt.connect(this.settings.url, {
          clientId: `${this.settings.clientId}-test`,
          username: this.settings.username ?? undefined,
          password: this.deps.getPassword(this.settings.passwordSecretId) ?? undefined,
          keepalive: 10,
          clean: true,
          rejectUnauthorized: this.settings.rejectUnauthorized,
          reconnectPeriod: 0,
          connectTimeout: 5000
        })
        c.on('connect', () => done(true, 'connected and authenticated'))
        c.on('error', (err) => done(false, err.message))
        setTimeout(() => done(false, 'timed out after 5 s'), 6000)
      } catch (err) {
        done(false, (err as Error).message)
      }
    })
    steps.push({ name: `Connect to ${this.settings.url}`, ok: result.ok, detail: result.detail })
    if (result.ok) {
      const c = this.client
      steps.push({
        name: 'Live connection',
        ok: !!c?.connected,
        detail: c?.connected
          ? 'adapter is connected'
          : this.settings.enabled
            ? `state: ${this.state.state}`
            : 'MQTT source is disabled'
      })
      const subs = this.settings.subscriptions.filter((s) => s.enabled)
      steps.push({
        name: 'Subscriptions',
        ok: true,
        detail: subs.length
          ? subs.map((s) => `${s.topic} (${this.counts.get(s.topic) ?? 0} msgs)`).join(', ')
          : 'none configured'
      })
      if (this.settings.publish.enabled)
        steps.push({
          name: 'Status publishing',
          ok: true,
          detail: `${this.baseTopic()}/status (retained)`
        })
    }
    report.ok = steps.every((s) => s.ok)
    report.durationMs = Date.now() - started
    return report
  }
}
