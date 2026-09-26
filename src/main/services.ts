import { EventEmitter } from 'events'
import { app, powerSaveBlocker } from 'electron'
import type { Profile } from '@shared/types/config'
import type { AppEvent } from '@shared/types/events'
import type { ReferenceData, RuntimeSnapshot, SimulateReport } from '@shared/types/state'
import { DMX_CHANNELS, LAYER_IDS } from '@shared/constants'
import {
  LIGHTING_MODE_INFO,
  LIGHTING_MODE_RANK,
  gateAction,
  localDayKey,
  type LightingMode
} from '@shared/lightingMode'
import { resolveActiveGroup } from '@shared/mappingGroups'
import { eqIgnoreCase } from '@shared/utils'
import { ConfigStore, type ConfigChange } from './config/store'
import { SecretVault } from './config/secrets'
import { ModeStateStore, type ModeState } from './config/modeState'
import { GroupStateStore } from './config/groupState'
import { Compositor } from './core/compositor/compositor'
import { Scheduler } from './core/compositor/scheduler'
import { EventBus } from './core/eventBus'
import { EventLog } from './core/eventLog'
import { ActionRunner } from './core/rules/actions'
import { RulesEngine } from './core/rules/engine'
import { SimulatorRegistry } from './core/simulators'
import { getLogger } from './logging'
import { UpdaterService } from './app/updater'
import { OutputManager } from './outputs/manager'
import { MqttAdapter } from './sources/mqtt/adapter'
import { commandGateRequest, parseMqttCommand } from './sources/mqtt/commands'
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
  readonly updater: UpdaterService
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
  private snapshotDebounce: ReturnType<typeof setTimeout> | null = null
  private lastSnapshotJson = ''
  private alertOverrides = new Map<string, string>()
  private modeStore: ModeStateStore
  private modeState: ModeState
  private groupStore: GroupStateStore
  /** When recent mapping-initiated group switches happened, to stop a switch loop. */
  private mappingGroupSwitches: number[] = []
  private heldBack: { count: number; last: { ts: number; text: string } | null } = {
    count: 0,
    last: null
  }
  private powerBlockerId: number | null = null
  private startedAt = Date.now()
  private publishTimer: ReturnType<typeof setTimeout> | null = null
  /** `universe:channel` → the timer that will clear an MQTT setChannel hold */
  private testHoldTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private stopped = false

  constructor(userData: string) {
    super()
    this.store = new ConfigStore(userData)
    this.secrets = new SecretVault(userData)
    this.updater = new UpdaterService(() => this.store.settings().autoCheckUpdates)
    this.updater.on('changed', () => this.scheduleSnapshot())
    this.modeStore = new ModeStateStore(userData)
    this.modeState = this.modeStore.create('normal')
    this.groupStore = new GroupStateStore(userData)
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
      warn: (m) => this.toast('warn', m),
      setMappingGroup: (id, by) => void this.setMappingGroup(id, 'mapping', by.mappingName)
    })
    this.engine = new RulesEngine(this.runner, {
      mode: () => this.modeState.mode,
      onHeldBack: (text) => this.recordHeldBack(text)
    })
    this.scheduler = new Scheduler(
      (now) => this.tick(now),
      40,
      (err, count) => {
        log.error(`compositor tick error (#${count})`, err)
        if (count === 1 || count % 200 === 0)
          this.toast('error', `Lighting engine tick error: ${(err as Error).message ?? err}`)
      }
    )
  }

  // ------------------------------------------------------------------ lifecycle

  async init(): Promise<void> {
    await this.store.load()
    await this.secrets.load()
    // Before any source starts: a restart mid-mission must not fire a burst of effects.
    const mode = await this.modeStore.load()
    this.modeState = mode.state
    await this.groupStore.load()
    if (mode.restored)
      this.toast(
        'warn',
        `Restarted in ${LIGHTING_MODE_INFO[mode.state.mode].label} mode (set earlier today)`
      )
    else if (mode.expired)
      log.info(
        `lighting mode ${mode.expired.mode} was set on ${mode.expired.day}; starting the new day in Normal`
      )
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
    this.thorium.on('scopeLeft', (simId: string) => {
      // Instances key on `simulator?.id ?? thoriumId` — for relative scenes that
      // is the *profile* id, so releasing by the Thorium id alone misses every
      // seeded alert scene. Release both keys for the departing simulator.
      const profileId =
        this.registry.profileByName(this.registry.thoriumSimulatorById(simId)?.name ?? '')?.id ??
        null
      this.compositor.release(
        (i) =>
          !i.origin.floor &&
          (i.simulatorId === simId || (profileId != null && i.simulatorId === profileId))
      )
    })
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
    // Before any source: the room gets its working light as soon as the app is
    // up, whether or not Thorium ever answers.
    this.applyFloors()
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
    this.updater.start()
    log.info('services started')
  }

  async shutdown(): Promise<void> {
    log.info('shutting down')
    this.stopped = true
    this.updater.stop()
    if (this.snapshotTimer) clearInterval(this.snapshotTimer)
    this.snapshotTimer = null
    if (this.snapshotDebounce) clearTimeout(this.snapshotDebounce)
    this.snapshotDebounce = null
    if (this.publishTimer) clearTimeout(this.publishTimer)
    this.publishTimer = null
    for (const t of this.testHoldTimers.values()) clearTimeout(t)
    this.testHoldTimers.clear()
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
    this.engine.setActiveGroup(this.activeGroupId(profile))
  }

  private activeGroupId(profile: Profile = this.store.active()): string | null {
    return resolveActiveGroup(profile.mappingGroups, this.groupStore.get(profile.id))
  }

  private applyFloors(): void {
    this.runner.applyFloors((m) => this.engine.isLive(m))
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
    this.applyFloors()
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
      perf: {
        eventsPerSec: this.bus.rate(),
        schedulerFps: this.scheduler.achievedFps()
      },
      mappingsStats: this.engine.statsSnapshot(),
      unresolvedMappings: Object.fromEntries(
        this.engine.unresolved().map((u) => [u.mappingId, { reason: u.reason, fatal: u.fatal }])
      ),
      alertOverrides: overrides,
      mappingGroup: {
        activeId: this.activeGroupId(),
        groups: this.store
          .active()
          .mappingGroups.map(({ id, name, color }) => ({ id, name, color }))
      },
      lightingMode: {
        mode: this.modeState.mode,
        since: this.modeState.since,
        staleDay:
          this.modeState.mode !== 'normal' && this.modeState.day !== localDayKey(Date.now()),
        heldBack: { count: this.heldBack.count, last: this.heldBack.last }
      },
      update: this.updater.getStatus()
    }
  }

  private scheduleSnapshot(): void {
    if (this.snapshotDebounce || this.stopped) return
    this.snapshotDebounce = setTimeout(() => {
      this.snapshotDebounce = null
      if (this.stopped) return
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
    if (this.publishTimer || this.stopped) return
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
      staffOrigin: true,
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
      staffOrigin: true,
      type: 'ui.action',
      name: 'scene.release',
      simulatorName: simulatorName ?? undefined,
      data: { sceneId, sceneName: scene.name, simulatorName }
    })
  }

  setBlackout(on: boolean, source: 'ui' | 'mqtt' = 'ui'): void {
    this.compositor.setBlackout(on)
    this.bus.emit({
      source,
      staffOrigin: source === 'ui',
      type: 'ui.action',
      name: 'blackout',
      data: { on }
    })
  }

  releaseAll(source: 'ui' | 'mqtt' = 'ui'): void {
    this.compositor.releaseAll()
    this.bus.emit({
      source,
      staffOrigin: source === 'ui',
      type: 'ui.action',
      name: 'releaseAll',
      data: {}
    })
  }

  setGrandMaster(v: number, source: 'ui' | 'mqtt' = 'ui'): void {
    this.compositor.setGrandMaster(v)
    void this.store.patchActiveProfile({ grandMaster: this.compositor.getGrandMaster() }, true)
    this.bus.emit({
      source,
      staffOrigin: source === 'ui',
      type: 'ui.action',
      name: 'grandMaster',
      data: { value: v }
    })
  }

  setAlertOverride(
    simulatorName: string,
    level: string | null,
    source: 'ui' | 'mqtt' = 'ui'
  ): void {
    const sim = this.registry.thoriumSimulatorByName(simulatorName)
    if (level) this.alertOverrides.set(simulatorName, level)
    else this.alertOverrides.delete(simulatorName)
    // The level to re-assert: the override itself, or (when clearing it) the
    // simulator's real current level. Never invent one — a fabricated '5' here
    // latches the Alert 5 scene with no way to clear it.
    const effective = level ?? sim?.alertLevel ?? null
    if (effective != null) {
      this.reassertAlertLevel(simulatorName, effective, level != null, source)
    } else {
      log.warn(
        `alert override cleared for "${simulatorName}" but its current level is unknown; not re-asserting a level`
      )
    }
    this.bus.emit({
      source,
      staffOrigin: source === 'ui',
      type: 'ui.action',
      name: 'alertOverride',
      simulatorName,
      data: { level, simulatorName }
    })
    this.scheduleSnapshot()
  }

  /** Emit a synthetic alert change so alert mappings re-apply `level` for one simulator. */
  private reassertAlertLevel(
    simulatorName: string,
    level: string,
    override: boolean,
    source: 'ui' | 'mqtt' | 'system'
  ): void {
    const sim = this.registry.thoriumSimulatorByName(simulatorName)
    this.bus.emit({
      source,
      staffOrigin: source === 'ui',
      type: 'thorium.state',
      name: 'alertLevel.changed',
      simulatorId: sim?.id,
      simulatorName,
      data: {
        level,
        rawLevel: level,
        training: false,
        previous: null,
        initial: false,
        override,
        simulatorName
      }
    })
  }

  // ------------------------------------------------------------------ lighting mode

  lightingMode(): LightingMode {
    return this.modeState.mode
  }

  async setLightingMode(
    mode: LightingMode,
    opts: { releaseUncleared?: boolean; catchUpAlerts?: boolean } = {},
    by: 'ui' | 'tray' = 'ui'
  ): Promise<void> {
    const previous = this.modeState.mode
    if (mode === previous) return
    this.modeState = this.modeStore.create(mode)
    this.heldBack = { count: 0, last: null }
    let released = 0
    if (mode === 'reduced' && opts.releaseUncleared) {
      const cleared = new Set(
        this.store
          .active()
          .scenes.filter((s) => s.reducedEffectsCleared)
          .map((s) => s.id)
      )
      // A no-signal floor is a steady working light — exactly what Reduced wants to keep.
      released = this.compositor.release(
        (i) => !i.origin.test && !i.origin.floor && !cleared.has(i.sceneId)
      )
    }
    log.info(`lighting mode ${previous} → ${mode} (by ${by})`)
    this.bus.emit({
      source: 'ui',
      staffOrigin: true,
      type: 'ui.action',
      name: 'lightingMode',
      data: { mode, previous, by }
    })
    if (opts.catchUpAlerts && LIGHTING_MODE_RANK[mode] < LIGHTING_MODE_RANK[previous])
      this.reassertAllAlertLevels()
    this.toast(
      mode === 'normal' ? 'info' : 'warn',
      mode === 'normal'
        ? 'Back to Normal lighting'
        : `${LIGHTING_MODE_INFO[mode].label} on${released ? ` — turned off ${released} scene${released === 1 ? '' : 's'}` : ''}`
    )
    this.scheduleSnapshot()
    await this.modeStore.save(this.modeState)
  }

  /** Re-apply every in-scope simulator's current alert level (or override) through the mappings. */
  private reassertAllAlertLevels(source: 'ui' | 'system' = 'ui'): void {
    for (const sim of this.registry.inScope()) {
      const override = this.alertOverrides.get(sim.name)
      const level = override ?? sim.alertLevel
      if (level != null) this.reassertAlertLevel(sim.name, level, override != null, source)
    }
  }

  /**
   * Make `groupId` the active mapping group. Looks from mappings that drop out
   * are released and the current alert levels are re-asserted, so the new
   * group's alert look shows straight away rather than at the next change.
   */
  async setMappingGroup(
    groupId: string,
    by: 'ui' | 'tray' | 'mapping',
    mappingName?: string
  ): Promise<void> {
    const profile = this.store.active()
    const group = profile.mappingGroups.find((g) => g.id === groupId)
    if (!group) {
      this.toast('warn', `Mapping group not found${mappingName ? ` (from "${mappingName}")` : ''}`)
      return
    }
    const previous = this.activeGroupId(profile)
    if (previous === groupId) return
    if (by === 'mapping') {
      // Switching re-asserts the alert level, which can fire another switch:
      // two groups whose alert mappings switch to each other would ping-pong
      // forever. Staff switches are never limited.
      const now = Date.now()
      this.mappingGroupSwitches = this.mappingGroupSwitches.filter((t) => now - t < 2000)
      if (this.mappingGroupSwitches.length >= 5) {
        this.toast(
          'error',
          `Ignored group switch from "${mappingName ?? '?'}": mappings are switching groups in a loop`
        )
        return
      }
      this.mappingGroupSwitches.push(now)
    }
    await this.groupStore.set(profile.id, groupId)
    this.engine.setActiveGroup(groupId)
    const byId = new Map(profile.mappings.map((m) => [m.id, m]))
    this.compositor.release((i) => {
      if (i.origin.test || i.origin.floor || !i.origin.mappingId) return false
      const m = byId.get(i.origin.mappingId)
      return m != null && !this.engine.isLive(m)
    })
    this.applyFloors()
    log.info(`mapping group → ${group.name} (by ${by}${mappingName ? ` "${mappingName}"` : ''})`)
    this.bus.emit({
      source: by === 'mapping' ? 'system' : 'ui',
      ...(by === 'mapping' ? {} : { staffOrigin: true }),
      type: by === 'mapping' ? 'system' : 'ui.action',
      name: 'mappingGroup',
      data: {
        groupId,
        groupName: group.name,
        previous,
        by,
        ...(mappingName ? { mappingName } : {})
      }
    })
    this.reassertAllAlertLevels(by === 'mapping' ? 'system' : 'ui')
    this.toast('info', `Mapping group: ${group.name}`)
    this.scheduleSnapshot()
  }

  /** Confirm a restrictive mode set on an earlier day is still wanted today. */
  async keepLightingModeForToday(): Promise<void> {
    this.modeState = { ...this.modeState, day: localDayKey(Date.now()) }
    this.scheduleSnapshot()
    await this.modeStore.save(this.modeState)
  }

  private recordHeldBack(text: string): void {
    this.heldBack = { count: this.heldBack.count + 1, last: { ts: Date.now(), text } }
    this.scheduleSnapshot()
  }

  private onMqttCommand(payload: unknown, topic: string): void {
    const r = parseMqttCommand(payload)
    if (!r.ok) {
      this.toast('warn', `Ignored MQTT command on ${topic}: ${r.error}`)
      return
    }
    const cmd = r.cmd
    const heldBack = gateAction(
      this.modeState.mode,
      commandGateRequest(cmd, (n) => this.runner.sceneByName(n)),
      { staffOrigin: false }
    )
    if (heldBack) {
      this.recordHeldBack(`MQTT ${cmd.action} — ${heldBack}`)
      this.bus.emit({
        source: 'mqtt',
        type: 'system',
        name: 'lightingMode.heldBack',
        data: { command: cmd.action, reason: heldBack, topic }
      })
      return
    }
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
        this.setGrandMaster(cmd.value, 'mqtt')
        return
      case 'setChannel': {
        const key = `${cmd.universe}:${cmd.channel}`
        const existing = this.testHoldTimers.get(key)
        if (existing) {
          clearTimeout(existing)
          this.testHoldTimers.delete(key)
        }
        this.compositor.setTestChannel(cmd.universe, cmd.channel, cmd.value)
        if (cmd.holdMs) {
          const t = setTimeout(() => {
            this.testHoldTimers.delete(key)
            this.compositor.setTestChannel(cmd.universe, cmd.channel, null)
          }, cmd.holdMs)
          this.testHoldTimers.set(key, t)
        }
        return
      }
      case 'alertLevel':
        this.setAlertOverride(cmd.simulator, cmd.level, 'mqtt')
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
        mappingId: m.mapping.id,
        mappingName: m.mapping.name,
        actions: m.allowed.map((a) => this.runner.describe(a)),
        ...(m.heldBack.length ? { heldBack: m.heldBack } : {})
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
        for (const a of m.allowed) {
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
            presets: m.triggers.map((t) => t.preset)
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
      '## Active compositor instances',
      '```',
      ...(this.compositor.getInstances().length
        ? this.compositor.getInstances().map((i) => {
            const chans = [...i.masks.entries()]
              .map(([u, m]) => {
                const set: number[] = []
                for (let c = 1; c < m.length; c++) if (m[c]) set.push(c)
                return set.length ? `U${u}:${summariseChannels(set)}` : null
              })
              .filter(Boolean)
              .join(' ')
            const layer = p.layers.find((l) => l.id === i.layerId)?.name ?? i.layerId
            return `${layer.padEnd(10)} "${i.sceneName}" sim=${i.simulatorName ?? i.simulatorId ?? '-'} started=${new Date(i.startedAt).toISOString()}${i.releaseStartedAt ? ' (releasing)' : ''} ${chans}`
          })
        : ['- none']),
      '```',
      '',
      '## Unresolved triggers',
      ...(this.engine
        .unresolved()
        .map(
          (u) =>
            `- ${p.mappings.find((m) => m.id === u.mappingId)?.name}: ${u.reason}${u.fatal ? '' : ' (partial — other triggers still fire)'}`
        ) || ['- none']),
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

/** "1,2,3,7,8" → "1-3,7-8" for the diagnostics channel dump. */
function summariseChannels(chs: number[]): string {
  if (chs.length === 0) return ''
  const sorted = [...chs].sort((a, b) => a - b)
  const runs: string[] = []
  let start = sorted[0]
  let prev = sorted[0]
  for (let i = 1; i <= sorted.length; i++) {
    const c = sorted[i]
    if (c === prev + 1) {
      prev = c
      continue
    }
    runs.push(start === prev ? `${start}` : `${start}-${prev}`)
    start = c
    prev = c
  }
  return runs.join(',')
}
