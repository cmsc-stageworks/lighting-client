import type {
  Action,
  ActionTarget,
  Mapping,
  Profile,
  Scene,
  SimulatorProfile
} from '@shared/types/config'
import type { AppEvent } from '@shared/types/events'
import { renderTemplate } from '@shared/templates'
import { readLevelInput, resolveFadeMs, resolveHoldMs, scaleLevel } from '@shared/levels'
import { LAYER_IDS } from '@shared/constants'
import type { EventBus } from '../eventBus'
import type { SimulatorRegistry } from '../simulators'
import type { Compositor, LevelStage } from '../compositor/compositor'
import { getLogger } from '../../logging'

const log = getLogger('actions')

/** Human phrase for a hold, used in action summaries. */
function describeHold(hold: Extract<Action, { kind: 'holdLevel' }>['hold']): string {
  if (hold.kind === 'latch') return 'until released'
  if (hold.kind === 'fixed') return `${hold.ms}ms`
  return `${hold.path}${hold.units === 'seconds' ? ' (s)' : ''}`
}

export interface ActionDeps {
  compositor: Compositor
  registry: SimulatorRegistry
  bus: EventBus
  profile: () => Profile
  mqttPublish: (topic: string, payload: string, qos: 0 | 1 | 2, retain: boolean) => void
  thorium: {
    triggerMacro: (simulatorId: string, macroName: string) => Promise<boolean>
    setAlertLevel: (simulatorId: string, level: string) => Promise<void>
    notify: (simulatorId: string, title: string, body: string, color: string) => Promise<void>
  }
  warn: (message: string) => void
}

interface TargetSim {
  profile: SimulatorProfile | null
  thoriumId: string | null
  key: string | null
}

/** Executes mapping actions. Also used directly by the UI and MQTT command paths. */
export class ActionRunner {
  constructor(private deps: ActionDeps) {}

  /** Resolve an action target to concrete simulators (profile + thorium id). */
  resolveTargets(target: ActionTarget, event: AppEvent | null): TargetSim[] {
    const reg = this.deps.registry
    const fromEvent = (): TargetSim[] => {
      if (event?.simulatorId || event?.simulatorName) {
        const profile = reg.profileByName(event.simulatorName) ?? null
        const thoriumId =
          event.simulatorId ?? reg.thoriumSimulatorByName(event.simulatorName ?? '')?.id ?? null
        return [{ profile, thoriumId, key: profile?.id ?? thoriumId }]
      }
      return []
    }
    if (target === 'event') {
      const t = fromEvent()
      if (t.length) return t
      // No simulator on the event → behave like "all" (single-ship collapses to one).
      return this.allTargets()
    }
    if (target === 'all') return this.allTargets()
    const profile = reg.profileByName(target.simulatorName) ?? null
    const thoriumId = reg.thoriumSimulatorByName(target.simulatorName)?.id ?? null
    if (!profile && !thoriumId) return []
    return [{ profile, thoriumId, key: profile?.id ?? thoriumId }]
  }

  private allTargets(): TargetSim[] {
    const reg = this.deps.registry
    const inScope = reg.inScope()
    if (inScope.length > 0) {
      return inScope.map((s) => {
        const profile = s.profileId ? (reg.profileById(s.profileId) ?? null) : null
        return { profile, thoriumId: s.id, key: profile?.id ?? s.id }
      })
    }
    // Thorium not connected: fall back to configured profiles (default profile in single-ship).
    const def = reg.defaultProfile()
    if (def) return [{ profile: def, thoriumId: null, key: def.id }]
    return reg.allProfiles().map((p) => ({ profile: p, thoriumId: null, key: p.id }))
  }

  sceneById(id: string): Scene | undefined {
    return this.deps.profile().scenes.find((s) => s.id === id)
  }
  sceneByName(name: string): Scene | undefined {
    return this.deps.profile().scenes.find((s) => s.name.toLowerCase() === name.toLowerCase())
  }
  layerByName(name: string): string | undefined {
    return this.deps.profile().layers.find((l) => l.name.toLowerCase() === name.toLowerCase())?.id
  }

  activateScene(
    scene: Scene,
    targets: TargetSim[],
    opts: {
      layerId?: string | null
      holdMsOverride?: number | null
      origin?: { mappingId?: string; eventId?: string; ui?: boolean }
    }
  ): void {
    if (scene.addressing === 'absolute') {
      // Absolute scenes are simulator-agnostic: activate once (keyed by the first target, if any).
      const t = targets[0]
      const { warnings } = this.deps.compositor.activate(scene, null, t?.thoriumId ?? null, opts)
      warnings.forEach((w) => this.deps.warn(w))
      return
    }
    if (targets.length === 0) {
      this.deps.warn(`Scene "${scene.name}" is relative but no simulator could be resolved`)
      return
    }
    for (const t of targets) {
      if (!t.profile) {
        this.deps.warn(
          `No simulator profile named "${this.deps.registry.thoriumSimulatorById(t.thoriumId ?? '')?.name ?? t.thoriumId}" — add it on the Simulators page to use relative scenes`
        )
        continue
      }
      const { warnings } = this.deps.compositor.activate(scene, t.profile, t.thoriumId, opts)
      warnings.forEach((w) => this.deps.warn(w))
    }
  }

  releaseScene(scene: Scene, targets: TargetSim[] | 'all'): void {
    if (targets === 'all' || scene.addressing === 'absolute') {
      this.deps.compositor.releaseScene(scene.id, 'all')
      return
    }
    for (const t of targets) this.deps.compositor.releaseScene(scene.id, t.key)
  }

  async run(mapping: Mapping, event: AppEvent, actions = mapping.actions): Promise<void> {
    for (const action of actions) {
      try {
        await this.runOne(action, event, mapping)
      } catch (err) {
        log.error(`action ${action.kind} in mapping "${mapping.name}" failed`, err)
        this.deps.warn(`Mapping "${mapping.name}": ${(err as Error).message}`)
      }
    }
  }

  async runOne(action: Action, event: AppEvent | null, mapping: Mapping | null): Promise<void> {
    const origin = { mappingId: mapping?.id, eventId: event?.id }
    switch (action.kind) {
      case 'activateScene': {
        const scene = this.sceneById(action.sceneId)
        if (!scene) return this.deps.warn(`Mapping "${mapping?.name}": scene not found`)
        this.activateScene(scene, this.resolveTargets(action.target, event), {
          layerId: action.layerId,
          holdMsOverride: action.holdMsOverride,
          origin
        })
        return
      }
      case 'releaseScene': {
        const scene = this.sceneById(action.sceneId)
        if (!scene) return
        this.releaseScene(
          scene,
          action.target === 'all' ? 'all' : this.resolveTargets(action.target, event)
        )
        return
      }
      case 'releaseLayer': {
        if (action.target === 'all') this.deps.compositor.releaseLayer(action.layerId, 'all')
        else
          for (const t of this.resolveTargets('event', event))
            this.deps.compositor.releaseLayer(action.layerId, t.key)
        return
      }
      case 'releaseAll':
        this.deps.compositor.releaseAll()
        return
      case 'blackout':
        this.deps.compositor.setBlackout(action.on)
        return
      case 'setLevel': {
        this.setLevel(action, event, mapping)
        return
      }
      case 'holdLevel': {
        this.holdLevel(action, event, mapping)
        return
      }
      case 'publishMqtt': {
        const ctx = event
          ? { ...event, simulator: event.simulatorName ?? null }
          : { ts: Date.now() }
        this.deps.mqttPublish(
          renderTemplate(action.topic, ctx),
          renderTemplate(action.payload, ctx),
          action.qos,
          action.retain
        )
        return
      }
      case 'thoriumMutation': {
        const targets = this.resolveTargets('event', event).filter((t) => t.thoriumId)
        if (targets.length === 0)
          return this.deps.warn('Thorium action skipped: no simulator in scope')
        for (const t of targets) {
          const simId = t.thoriumId!
          const m = action.mutation
          if (m.kind === 'triggerMacro') {
            const ok = await this.deps.thorium.triggerMacro(simId, m.macroName)
            if (!ok) this.deps.warn(`Macro "${m.macroName}" not found on Thorium`)
          } else if (m.kind === 'setAlertLevel')
            await this.deps.thorium.setAlertLevel(simId, m.level)
          else await this.deps.thorium.notify(simId, m.title, m.body, m.color)
        }
        return
      }
    }
  }

  /**
   * Drive a `setLevel` action. One compositor instance per action per simulator,
   * so a stream of intensity changes updates a single channel follow in place.
   */
  private setLevel(
    action: Extract<Action, { kind: 'setLevel' }>,
    event: AppEvent | null,
    mapping: Mapping | null
  ): void {
    const data = event?.data ?? {}
    const input = readLevelInput(data, action.source.path)
    if (input == null) {
      this.deps.warn(
        `Mapping "${mapping?.name ?? '?'}": no number at "${action.source.path}" on ${event?.name ?? 'the event'}`
      )
      return
    }
    this.applyLevel(
      {
        // Identity has to be stable across events but distinct per simulator, so
        // two ships following their own intensity do not fight over one
        // instance. It deliberately ignores the ranges, curve, fade and label,
        // so editing those moves the running level rather than leaving a stale
        // one behind.
        base: this.levelKey('level', action, mapping, action.source.path),
        value: scaleLevel(input, action.source),
        fadeMs: resolveFadeMs(action.fade, data),
        holdMs: null,
        label: action.label || `Level ${action.source.path}`
      },
      action,
      event,
      mapping
    )
  }

  /**
   * Drive a `holdLevel` action: the value is fixed in the action, the event only
   * says how long to keep it. Re-firing re-arms the hold on the same instance.
   */
  private holdLevel(
    action: Extract<Action, { kind: 'holdLevel' }>,
    event: AppEvent | null,
    mapping: Mapping | null
  ): void {
    const data = event?.data ?? {}
    const fadeMs = resolveFadeMs(action.fade, data)
    const holdMs = this.holdMsFor(action.hold, data, event, mapping)
    const fallback = action.fallback
    this.applyLevel(
      {
        base: this.levelKey('hold', action, mapping, String(action.value)),
        value: action.value,
        fadeMs,
        holdMs,
        // The second stage is handed to the compositor rather than timed here:
        // it owns the clock, so the step down survives a busy event loop and is
        // dropped with the instance when something releases it early.
        nextStage: fallback
          ? {
              value: fallback.value,
              holdMs: this.holdMsFor(fallback.hold, data, event, mapping),
              fadeMs
            }
          : null,
        label: action.label || `Hold ${action.value}`
      },
      action,
      event,
      mapping
    )
  }

  /** Resolve a hold, warning when the event was supposed to carry it and didn't. */
  private holdMsFor(
    hold: Extract<Action, { kind: 'holdLevel' }>['hold'],
    data: unknown,
    event: AppEvent | null,
    mapping: Mapping | null
  ): number | null {
    const ms = resolveHoldMs(hold, data)
    if (hold.kind === 'fromEvent' && readLevelInput(data, hold.path) == null) {
      // Not fatal the way a missing value is — the fallback still gives a
      // sensible hold — but silence would hide a mistyped path.
      this.deps.warn(
        `Mapping "${mapping?.name ?? '?'}": no duration at "${hold.path}" on ${event?.name ?? 'the event'}, holding for ${ms}ms`
      )
    }
    return ms
  }

  /**
   * Stable identity for a level instance (see `setLevel` above). `tail`
   * separates instances that share channels: the source path for a follow, the
   * value for a hold, so two holds in one mapping do not overwrite each other.
   */
  private levelKey(
    prefix: string,
    action: Extract<Action, { kind: 'setLevel' | 'holdLevel' }>,
    mapping: Mapping | null,
    tail: string
  ): string {
    return [
      prefix,
      mapping?.id ?? 'direct',
      action.addressing === 'absolute' ? `u${action.universe ?? ''}` : 'rel',
      action.channels.join('.'),
      tail
    ].join(':')
  }

  /** Shared plumbing for both level actions: resolve the address, drive the compositor. */
  private applyLevel(
    level: {
      base: string
      value: number
      fadeMs: number
      holdMs: number | null
      nextStage?: LevelStage | null
      label: string
    },
    action: Extract<Action, { kind: 'setLevel' | 'holdLevel' }>,
    event: AppEvent | null,
    mapping: Mapping | null
  ): void {
    const { base, value, fadeMs, holdMs, nextStage = null, label } = level
    const layerId = action.layerId ?? LAYER_IDS.scene

    if (action.addressing === 'absolute') {
      const universe = action.universe ?? this.deps.profile().outputs[0]?.universe ?? 1
      const { warnings } = this.deps.compositor.setLevel(base, {
        layerId,
        universe,
        channels: action.channels,
        value,
        fadeMs,
        holdMs,
        nextStage,
        label
      })
      warnings.forEach((w) => this.deps.warn(w))
      return
    }

    const targets = this.resolveTargets(action.target, event)
    if (targets.length === 0) {
      this.deps.warn(`Mapping "${mapping?.name ?? '?'}": no simulator resolved for "${label}"`)
      return
    }
    for (const t of targets) {
      if (!t.profile) {
        this.deps.warn(
          `No simulator profile named "${this.deps.registry.thoriumSimulatorById(t.thoriumId ?? '')?.name ?? t.thoriumId}" — add it on the Simulators page to use relative levels`
        )
        continue
      }
      const { warnings } = this.deps.compositor.setLevel(`${base}:${t.profile.id}`, {
        layerId,
        universe: t.profile.universe,
        channels: action.channels.map((ch) => t.profile!.baseAddress + ch),
        value,
        fadeMs,
        holdMs,
        nextStage,
        label,
        simulatorKey: t.profile.id,
        simulatorName: t.profile.name
      })
      warnings.forEach((w) => this.deps.warn(w))
    }
  }

  describe(action: Action): string {
    switch (action.kind) {
      case 'activateScene':
        return `Activate "${this.sceneById(action.sceneId)?.name ?? '?'}"`
      case 'releaseScene':
        return `Release "${this.sceneById(action.sceneId)?.name ?? '?'}"`
      case 'releaseLayer':
        return `Release layer ${this.deps.profile().layers.find((l) => l.id === action.layerId)?.name ?? '?'}`
      case 'releaseAll':
        return 'Release all'
      case 'blackout':
        return action.on ? 'Blackout on' : 'Blackout off'
      case 'setLevel':
        return `Set ch ${action.channels.join(', ')} from ${action.source.path}`
      case 'holdLevel':
        return `Hold ch ${action.channels.join(', ')} at ${action.value} for ${describeHold(action.hold)}${
          action.fallback
            ? `, then ${action.fallback.value} for ${describeHold(action.fallback.hold)}`
            : ''
        }`
      case 'publishMqtt':
        return `Publish ${action.topic}`
      case 'thoriumMutation':
        return `Thorium: ${action.mutation.kind}`
    }
  }
}
