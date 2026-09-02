import { EventEmitter } from 'events'
import { app, powerSaveBlocker } from 'electron'
import type { Profile } from '@shared/types/config'
import type { AppEvent } from '@shared/types/events'
import type { ReferenceData, RuntimeSnapshot, SimulateReport } from '@shared/types/state'
import { DMX_CHANNELS, LAYER_IDS } from '@shared/constants'
import { eqIgnoreCase } from '@shared/utils'
import { ConfigStore, type ConfigChange } from './config/store'
import { SecretVault } from './config/secrets'
import { Compositor } from './core/compositor/compositor'
import { Scheduler } from './core/compositor/scheduler'
import { EventBus } from './core/eventBus'
import { EventLog } from './core/eventLog'
import { ActionRunner } from './core/rules/actions'
import { RulesEngine } from './core/rules/engine'
import { SimulatorRegistry } from './core/simulators'
import { getLogger } from './logging'
import { OutputManager } from './outputs/manager'
import { MqttAdapter } from './sources/mqtt/adapter'
import { parseMqttCommand } from './sources/mqtt/commands'
import { StatusPublisher } from './sources/mqtt/publisher'
import { ThoriumAdapter } from './sources/thorium/adapter'

const log = getLogger('services')

export interface ServicesEvents {
  snapshot: (snap: RuntimeSnapshot) => void
  events: (batch: AppEvent[]) => void
  frame: (payload: { universe: number; values: number[]; owners: (string | null)[] }) => void
  toast: (t: { level: 'info' | 'warn' | 'error' | 'success'; message: string }) => void
  refdata: (r: ReferenceData) => void
  mqttMessage: (m: {
    ts: number
    topic: string
    payload: string
    qos: number
    retain: boolean
  }) => void
}

/**
 * Wires every main-process service together and exposes the command surface used
 * by the IPC router, the tray and the MQTT command topic.
 */
export class Services extends EventEmitter {
  readonly store: ConfigStore
  readonly secrets: SecretVault
  readonly bus = new EventBus()
  readonly registry = new SimulatorRegistry()
  readonly compositor = new Compositor()
  readonly outputs = new OutputManager()
  readonly log: EventLog
  readonly runner: ActionRunner
  readonly engine: RulesEngine
  thorium!: ThoriumAdapter
  mqtt!: MqttAdapter
  private publisher!: StatusPublisher
  private scheduler: Scheduler
  private lastFrames = new Map<number, Uint8Array>()
  private subscribedUniverses = new Set<number>()
  private frameTick = 0
  private snapshotTimer: ReturnType<typeof setInterval> | null = null
  private lastSnapshotJson = ''
  private alertOverrides = new Map<string, string>()
  private powerBlockerId: number | null = null
  private startedAt = Date.now()
  private publishTimer: ReturnType<typeof setTimeout> | null = null

  constructor(userData: string) {
    super()
    this.store = new ConfigStore(userData)
    this.secrets = new SecretVault(userData)
    this.log = new EventLog(2000, (batch) => this.emit('events', batch))
    this.runner = new ActionRunner({
      compositor: this.compositor,
      registry: this.registry,
      bus: this.bus,
      profile: () => this.store.active(),
      mqttPublish: (t, p, q, r) => this.mqtt?.publish(t, p, q, r),
      thorium: {
        triggerMacro: (s, m) => this.thorium.triggerMacro(s, m),
        setAlertLevel: (s, l) => this.thorium.setAlertLevel(s, l),
        notify: (s, t, b, c) => this.thorium.notify(s, t, b, c)
      },
      warn: (m) => this.toast('warn', m)
    })
    this.engine = new RulesEngine(this.runner)
    this.scheduler = new Scheduler((now) => this.tick(now), 40)
  }

  // ------------------------------------------------------------------ lifecycle

  async init(): Promise<void> {
    await this.store.load()
    await this.secrets.load()
    if (this.store.loadError)
      this.toast(
        'error',
        `Config could not be loaded (${this.store.loadError}). Running on defaults; restore a backup from Settings.`
      )
    this.log.setCapacity(this.store.settings().eventLogSize)

    const profile = this.store.active()
    this.applyProfileToCore(profile)

    this.thorium = new ThoriumAdapter(profile.thorium, this.bus, this.registry)
    this.thorium.on('state', () => this.scheduleSnapshot())
    this.thorium.on('refdata', (r: ReferenceData) => {
      this.engine.setReferenceData(r)
      this.emit('refdata', r)
    })
    this.thorium.on('scopeLeft', (simId: string) =>
      this.compositor.release((i) => i.simulatorId === simId)
    )
    this.thorium.on('assignmentLost', (info: { previousFlight: string | null }) => {
      const behavior = this.store.active().thorium.unassignedBehavior
      if (behavior === 'release') {
        this.compositor.releaseAll()
        this.toast(
          'warn',
          `Flight assignment changed (was ${info.previousFlight ?? 'unassigned'}); released all scenes`
        )
      } else {
        this.toast(
          'warn',
          `Flight assignment changed (was ${info.previousFlight ?? 'unassigned'}); holding current output`
        )
      }
    })

    this.mqtt = new MqttAdapter(profile.mqtt, {
      bus: this.bus,
      getPassword: (id) => this.secrets.get(id),
      instanceName: () => this.store.settings().instanceName,
      onCommand: (payload, topic) => this.onMqttCommand(payload, topic)
    })
    this.mqtt.on('state', () => this.scheduleSnapshot())
    this.mqtt.on('message', (m) => this.emit('mqttMessage', m))
    this.mqtt.on('connected', () => {
      this.publisher.reset()
      this.schedulePublish()
    })
    this.publisher = new StatusPublisher(
      () => this.mqtt,
      () => this.store.active().mqtt.publish.enabled,
      () => this.store.active().mqtt.publish.qos,
      app.getVersion(),
      () => this.store.active().name,
      this.startedAt
    )

    // Rules engine listens first so it can annotate matched mapping ids.
    this.bus.onFirst((ev) => this.engine.onEvent(ev))
    this.bus.on((ev) => {
      this.log.append(ev)
      if (ev.type === 'thorium.event') this.thorium.setSeenEventNames(this.log.seenEventNames())
      if (this.store.active().mqtt.publish.publishEvents) this.publisher.publishEvent(ev)
    })
    this.engine.setReferenceData(this.thorium.referenceData())

    this.compositor.on('change', () => this.scheduleSnapshot())
    this.outputs.on('universesChanged', (u: number[]) => {
      this.compositor.setCarriedUniverses(u)
      this.scheduler.setFps(this.outputs.maxFps())
      this.updatePowerBlocker()
    })
    this.outputs.on('stateChange', (c: { name: string; to: string; reason?: string }) => {
      if (c.to === 'error') this.toast('error', `Output "${c.name}": ${c.reason ?? 'error'}`)
      else if (c.to === 'ok') this.toast('success', `Output "${c.name}" is online`)
      this.bus.emit({
        source: 'system',
        type: 'system',
        name: c.to === 'error' ? 'output.error' : 'output.ok',
        data: c
      })
      this.scheduleSnapshot()
    })

    this.store.on('change', (c: ConfigChange) => void this.onConfigChange(c))

    await this.outputs.apply(profile.outputs)
    this.scheduler.start()
    this.thorium.start()
    this.mqtt.start()
    this.snapshotTimer = setInterval(() => {
      this.outputs.health()
      this.scheduleSnapshot()
    }, 1000)
    this.bus.emit({
      source: 'system',
      type: 'system',
      name: 'startup',
      data: { version: app.getVersion() }
    })
    log.info('services started')
  }

  async shutdown(): Promise<void> {
    log.info('shutting down')
    if (this.snapshotTimer) clearInterval(this.snapshotTimer)
    this.scheduler.stop()
    if (this.store.settings().sendZeroFrameOnExit) await this.outputs.sendZeroAll()
    await this.outputs.stopAll()
    await this.thorium.stop().catch(() => undefined)
    await this.mqtt.stop().catch(() => undefined)
    this.log.dispose()
    if (this.powerBlockerId != null) powerSaveBlocker.stop(this.powerBlockerId)
  }

  private updatePowerBlocker(): void {
    const active = this.outputs.universes().length > 0
    if (active && this.powerBlockerId == null)
      this.powerBlockerId = powerSaveBlocker.start('prevent-app-suspension')
    if (!active && this.powerBlockerId != null) {
      powerSaveBlocker.stop(this.powerBlockerId)
      this.powerBlockerId = null
    }
  }

  private applyProfileToCore(profile: Profile): void {
    this.compositor.setLayers(profile.layers)
    this.compositor.setGrandMaster(profile.grandMaster)
    this.registry.setProfiles(profile.simulators, profile.kind)
    this.registry.setScope(profile.thorium.scope)
    this.engine.setMappings(profile.mappings)
  }

  private async onConfigChange(c: ConfigChange): Promise<void> {
    const profile = this.store.active()
    this.log.setCapacity(this.store.settings().eventLogSize)
    if (c.scope === 'settings') {
      this.scheduleSnapshot()
      return
    }
    this.applyProfileToCore(profile)
    await this.outputs.apply(profile.outputs)
    await this.thorium.updateSettings(profile.thorium)
    await this.mqtt.updateSettings(profile.mqtt)
    if (c.scope === 'activeProfile' || c.scope === 'all') {
      this.compositor.drop(() => true)
      this.alertOverrides.clear()
    }
    this.scheduleSnapshot()
  }

  // ------------------------------------------------------------------ tick

  private tick(now: number): void {
    this.compositor.tick()
    for (const u of this.compositor.universes()) {
      const dirty = this.compositor.isDirty(u)
      const frame = this.compositor.frame(u)
      const prev = this.lastFrames.get(u)
      let changed = dirty || !prev
      if (prev && dirty) {
        changed = false
        for (let i = 1; i <= DMX_CHANNELS; i++) {
          if (prev[i] !== frame.values[i]) {
            changed = true
            break
          }
        }
      }
      if (changed) this.lastFrames.set(u, Uint8Array.from(frame.values))
      this.outputs.deliver(u, frame.values, changed, now)
    }
    // Push monitor frames at ~10 Hz
    if (++this.frameTick % Math.max(1, Math.round(this.outputs.maxFps() / 10)) === 0) {
      for (const u of this.subscribedUniverses) {
        const f = this.compositor.frame(u)
        this.emit('frame', {
          universe: u,
          values: Array.from(f.values.subarray(1)),
          owners: f.owners.slice(1)
        })
      }
    }
  }

  // ------------------------------------------------------------------ snapshot

  snapshot(): RuntimeSnapshot {
    const overrides: Record<string, string> = {}
    for (const [k, v] of this.alertOverrides) overrides[k] = v
    return {
      ts: Date.now(),
      thorium: this.thorium.runtime(),
      mqtt: this.mqtt.runtime(),
      outputs: this.outputs.health(),
      compositor: {
        blackout: this.compositor.isBlackout(),
        grandMaster: this.compositor.getGrandMaster(),
        active: this.compositor.activeSummaries(),
        universes: this.compositor.universes()
      },
      mappingsStats: this.engine.statsSnapshot(),
      unresolvedMappings: Object.fromEntries(
        this.engine.unresolved().map((u) => [u.mappingId, u.reason])
      ),
      alertOverrides: overrides
    }
  }

  private snapshotPending = false
  private scheduleSnapshot(): void {
    if (this.snapshotPending) return
    this.snapshotPending = true
    setTimeout(() => {
      this.snapshotPending = false
      const snap = this.snapshot()
      const json = JSON.stringify({ ...snap, ts: 0 })
      if (json !== this.lastSnapshotJson) {
        this.lastSnapshotJson = json
        this.emit('snapshot', snap)
        this.schedulePublish()
      }
    }, 50)
  }

  private schedulePublish(): void {
    if (this.publishTimer) return
    this.publishTimer = setTimeout(() => {
      this.publishTimer = null
      const p = this.store.active()
      const names: Record<string, string> = {}
      const outs: Record<string, { driver: string; universe: number }> = {}
      for (const o of p.outputs) {
        names[o.id] = o.name
        outs[o.id] = { driver: o.driver, universe: o.universe }
      }
      this.publisher.publishSnapshot(this.snapshot(), names, outs)
    }, 250)
  }

  toast(level: 'info' | 'warn' | 'error' | 'success', message: string): void {
    log[level === 'success' ? 'info' : level](message)
    this.emit('toast', { level, message })
  }

  // ------------------------------------------------------------------ commands (UI / MQTT)

  subscribeUniverse(universe: number, on: boolean): void {
    if (on) this.subscribedUniverses.add(universe)
    else this.subscribedUniverses.delete(universe)
  }

  activateSceneByUser(
    sceneId: string,
    simulatorName: string | null,
    layerId?: string | null
  ): void {
    const scene = this.runner.sceneById(sceneId)
    if (!scene) return this.toast('warn', 'Scene not found')
    const targets = simulatorName
      ? this.runner.resolveTargets({ simulatorName }, null)
      : this.runner.resolveTargets('all', null)
    this.runner.activateScene(scene, targets, { layerId: layerId ?? null, origin: { ui: true } })
    this.bus.emit({
      source: 'ui',
      type: 'ui.action',
      name: 'scene.activate',
      simulatorName: simulatorName ?? undefined,
      data: { sceneId, sceneName: scene.name, simulatorName }
    })
  }

  releaseSceneByUser(sceneId: string, simulatorName: string | null): void {
    const scene = this.runner.sceneById(sceneId)
    if (!scene) return
    this.runner.releaseScene(
      scene,
      simulatorName ? this.runner.resolveTargets({ simulatorName }, null) : 'all'
    )
    this.bus.emit({
      source: 'ui',
      type: 'ui.action',
      name: 'scene.release',
      simulatorName: simulatorName ?? undefined,
      data: { sceneId, sceneName: scene.name, simulatorName }
    })
  }

  setBlackout(on: boolean, source: 'ui' | 'mqtt' = 'ui'): void {
    this.compositor.setBlackout(on)
    this.bus.emit({ source, type: 'ui.action', name: 'blackout', data: { on } })
  }

  releaseAll(source: 'ui' | 'mqtt' = 'ui'): void {
    this.compositor.releaseAll()
    this.bus.emit({ source, type: 'ui.action', name: 'releaseAll', data: {} })
  }

  setGrandMaster(v: number): void {
    this.compositor.setGrandMaster(v)
    void this.store.patchActiveProfile({ grandMaster: this.compositor.getGrandMaster() }, true)
    this.bus.emit({ source: 'ui', type: 'ui.action', name: 'grandMaster', data: { value: v } })
  }

  setAlertOverride(simulatorName: string, level: string | null): void {
    const sim = this.registry.thoriumSimulatorByName(simulatorName)
    if (level) this.alertOverrides.set(simulatorName, level)
    else this.alertOverrides.delete(simulatorName)
    const effective = level ?? sim?.alertLevel ?? '5'
    this.bus.emit({
      source: 'ui',
      type: 'thorium.state',
      name: 'alertLevel.changed',
      simulatorId: sim?.id,
      simulatorName,
      data: {
        level: effective,
        rawLevel: effective,
        training: false,
        previous: null,
        initial: false,
        override: level != null,
        simulatorName
      }
    })
    this.bus.emit({
      source: 'ui',
      type: 'ui.action',
      name: 'alertOverride',
      simulatorName,
      data: { level, simulatorName }
    })
    this.scheduleSnapshot()
  }

  private onMqttCommand(payload: unknown, topic: string): void {
    const r = parseMqttCommand(payload)
    if (!r.ok) {
      this.toast('warn', `Ignored MQTT command on ${topic}: ${r.error}`)
      return
    }
    const cmd = r.cmd
    switch (cmd.action) {
      case 'activateScene': {
        const scene = this.runner.sceneByName(cmd.scene)
        if (!scene) return this.toast('warn', `MQTT command: scene "${cmd.scene}" not found`)
        const layerId = cmd.layer ? (this.runner.layerByName(cmd.layer) ?? null) : null
        this.runner.activateScene(
          scene,
          cmd.simulator
            ? this.runner.resolveTargets({ simulatorName: cmd.simulator }, null)
            : this.runner.resolveTargets('all', null),
          { layerId, origin: {} }
        )
        return
      }
      case 'releaseScene': {
        const scene = this.runner.sceneByName(cmd.scene)
        if (scene)
          this.runner.releaseScene(
            scene,
            cmd.simulator
              ? this.runner.resolveTargets({ simulatorName: cmd.simulator }, null)
              : 'all'
          )
        return
      }
      case 'releaseLayer': {
        const id = this.runner.layerByName(cmd.layer)
        if (id) this.compositor.releaseLayer(id)
        return
      }
      case 'releaseAll':
        this.releaseAll('mqtt')
        return
      case 'blackout':
        this.setBlackout(cmd.on, 'mqtt')
        return
      case 'grandMaster':
        this.setGrandMaster(cmd.value)
        return
      case 'setChannel': {
        this.compositor.setTestChannel(cmd.universe, cmd.channel, cmd.value)
        if (cmd.holdMs)
          setTimeout(
            () => this.compositor.setTestChannel(cmd.universe, cmd.channel, null),
            cmd.holdMs
          )
        return
      }
      case 'alertLevel':
        this.setAlertOverride(cmd.simulator, cmd.level)
        return
    }
  }

  // ------------------------------------------------------------------ simulate

  simulate(
    input: {
      type: string
      name: string
      simulatorName: string | null
      data: Record<string, unknown>
    },
    live: boolean
  ): SimulateReport {
    const sim = input.simulatorName
      ? this.registry.thoriumSimulatorByName(input.simulatorName)
      : undefined
    const ev = this.bus.create({
      source: input.type.startsWith('mqtt')
        ? 'mqtt'
        : input.type.startsWith('ui')
          ? 'ui'
          : input.type === 'system'
            ? 'system'
            : 'thorium',
      type: input.type as AppEvent['type'],
      name: input.name,
      simulatorId: sim?.id,
      simulatorName: input.simulatorName ?? undefined,
      data: input.data
    })
    const matched = this.engine.evaluate(ev)
    const before = new Map<number, Uint8Array>()
    for (const u of this.compositor.universes())
      before.set(u, Uint8Array.from(this.compositor.frame(u).values))
    const report: SimulateReport = {
      event: {
        type: ev.type,
        name: ev.name,
        simulatorName: ev.simulatorName ?? null,
        data: ev.data
      },
      matched: matched.map((m) => ({
        mappingId: m.id,
        mappingName: m.name,
        actions: m.actions.map((a) => this.runner.describe(a))
      })),
      frames: [],
      live
    }
    if (live) {
      ev.data = { ...ev.data, simulated: true }
      this.bus.publish(ev)
      this.compositor.tick()
      for (const u of this.compositor.universes()) {
        const after = this.compositor.frame(u).values
        const prev = before.get(u)
        const changed: { channel: number; value: number }[] = []
        for (let i = 1; i <= DMX_CHANNELS; i++)
          if (!prev || prev[i] !== after[i]) changed.push({ channel: i, value: after[i] })
        if (changed.length) report.frames.push({ universe: u, changed })
      }
    } else {
      // Predict channel writes without touching the compositor.
      for (const m of matched) {
        for (const a of m.actions) {
          if (a.kind !== 'activateScene') continue
          const scene = this.runner.sceneById(a.sceneId)
          if (!scene) continue
          for (const t of this.runner.resolveTargets(a.target, ev)) {
            const { frames } = Compositor.resolveScene(scene, t.profile)
            for (const [u, f] of frames) {
              const changed: { channel: number; value: number }[] = []
              for (let i = 1; i <= DMX_CHANNELS; i++)
                if (f[i]) changed.push({ channel: i, value: f[i] })
              report.frames.push({ universe: u, changed })
            }
            if (scene.addressing === 'absolute') break
          }
        }
      }
    }
    return report
  }

  // ------------------------------------------------------------------ diagnostics

  async diagnostics(versions: Record<string, string>, logTail: string[]): Promise<string> {
    const p = this.store.active()
    const snap = this.snapshot()
    const redact = (x: unknown): unknown =>
      JSON.parse(
        JSON.stringify(x, (k, v) => (k === 'passwordSecretId' ? (v ? '<secret>' : null) : v))
      )
    const lines = [
      '# CMSC Lighting Client diagnostics',
      `Generated: ${new Date().toISOString()}`,
      '',
      '## Versions',
      ...Object.entries(versions).map(([k, v]) => `- ${k}: ${v}`),
      '',
      '## Profile',
      '```json',
      JSON.stringify(
        redact({
          name: p.name,
          kind: p.kind,
          thorium: p.thorium,
          mqtt: { ...p.mqtt, subscriptions: p.mqtt.subscriptions.length },
          outputs: p.outputs,
          simulators: p.simulators,
          layers: p.layers,
          scenes: p.scenes.length,
          mappings: p.mappings.map((m) => ({
            name: m.name,
            enabled: m.enabled,
            preset: m.trigger.preset
          }))
        }),
        null,
        2
      ),
      '```',
      '',
      '## Runtime',
      '```json',
      JSON.stringify(snap, null, 2),
      '```',
      '',
      '## Unresolved triggers',
      ...(this.engine
        .unresolved()
        .map((u) => `- ${p.mappings.find((m) => m.id === u.mappingId)?.name}: ${u.reason}`) || [
        '- none'
      ]),
      '',
      '## Last 200 events',
      ...this.log
        .recent(200)
        .map(
          (e) =>
            `${new Date(e.ts).toISOString()} ${e.source} ${e.type} ${e.name}${e.simulatorName ? ' [' + e.simulatorName + ']' : ''}${e.matchedMappingIds.length ? ' → ' + e.matchedMappingIds.length + ' mapping(s)' : ''}`
        ),
      '',
      '## Log tail',
      '```',
      ...logTail,
      '```'
    ]
    return lines.join('\n')
  }

  /** Helper for the UI: which simulator profile names exist and whether they match Thorium names. */
  simulatorNameMatches(name: string): boolean {
    return this.registry.allThoriumSimulators().some((s) => eqIgnoreCase(s.name, name))
  }

  layerIdForTest(): string {
    return LAYER_IDS.test
  }
}
