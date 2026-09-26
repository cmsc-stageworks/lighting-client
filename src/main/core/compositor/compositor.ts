import { EventEmitter } from 'events'
import type { Layer, Scene, SimulatorProfile } from '@shared/types/config'
import type { ActiveSceneSummary } from '@shared/types/state'
import { DMX_CHANNELS, LAYER_IDS } from '@shared/constants'
import { clamp, uuid } from '@shared/utils'
import { DONE, envelopeIsAnimating, envelopeLevel, type EnvelopeState } from './envelope'

export interface ActiveInstance extends EnvelopeState {
  instanceId: string
  sceneId: string
  sceneName: string
  layerId: string
  simulatorId: string | null
  simulatorName: string | null
  holdUntil: number | null
  /** universe → 513-byte values (index 1..512) */
  frames: Map<number, Uint8Array>
  /** universe → 513-byte mask (1 = scene sets this channel) */
  masks: Map<number, Uint8Array>
  /**
   * Identity of a self-updating level instance (the `setLevel` action), so a
   * stream of value changes updates one instance in place. Null for scenes.
   */
  levelKey: string | null
  /**
   * Values to interpolate *from* while a level change is in flight. A level
   * instance fades its channel values; it does not fade its own opacity the way
   * a scene does, because there is nothing underneath it to cross into.
   */
  fromFrames: Map<number, Uint8Array> | null
  valueFadeStartedAt: number
  valueFadeMs: number
  /** The 0–255 level a `setLevel` instance is heading to (for the Dashboard). */
  levelValue: number | null
  /**
   * What a level does when its hold runs out instead of releasing: move to this
   * value and hold *that* (the `holdLevel` action's fallback stage). Cleared
   * once it has been applied, so a level only steps down once per firing.
   */
  nextStage: LevelStage | null
  origin: {
    mappingId?: string
    eventId?: string
    ui?: boolean
    test?: boolean
    /**
     * A `setLevel` action's "no signal" floor (see `ActionRunner.applyFloors`).
     * Owned by the config, not by events: layer and release-all paths leave it
     * alone so it is still there when the live level lets go.
     */
    floor?: boolean
  }
}

/** Progress of an in-place value fade; 1 once it has settled. */
function valueFadeT(i: ActiveInstance, now: number): number {
  if (!i.fromFrames || i.valueFadeMs <= 0) return 1
  const t = (now - i.valueFadeStartedAt) / i.valueFadeMs
  return t >= 1 ? 1 : Math.max(0, t)
}

/** An instance's value for one channel, part-way through any in-place value fade. */
function instanceValue(i: ActiveInstance, universe: number, ch: number, now: number): number {
  const target = i.frames.get(universe)![ch]
  const t = valueFadeT(i, now)
  if (t >= 1) return target
  const from = i.fromFrames?.get(universe)?.[ch] ?? 0
  return from + (target - from) * t
}

/** A follow-on value for a held level: move here when the hold ends, then hold. */
export interface LevelStage {
  value: number
  /** Null holds the new value until something releases it. */
  holdMs: number | null
  fadeMs: number
}

export interface ResolvedFrame {
  values: Uint8Array // 513
  owners: (string | null)[] // 513, instanceId
}

export interface ActivateOptions {
  layerId?: string | null
  holdMsOverride?: number | null
  origin?: ActiveInstance['origin']
}

export interface CompositorEvents {
  change: () => void
}

/**
 * Holds active scene instances and renders per-universe frames using priority
 * layers with crossfades (ERD §6). Time is injected so tests are deterministic.
 */
export class Compositor extends EventEmitter {
  private layers: Layer[] = []
  private instances: ActiveInstance[] = []
  private blackout = false
  private grandMaster = 1
  private dirty = new Set<number>()
  private cache = new Map<number, ResolvedFrame>()
  private carried = new Set<number>()

  constructor(private now: () => number = () => Date.now()) {
    super()
  }

  // ------------------------------------------------------------------ config

  setLayers(layers: Layer[]): void {
    this.layers = [...layers].sort((a, b) => a.priority - b.priority)
    this.markAllDirty()
  }

  /** Universes carried by outputs; frames are rendered for these plus any touched by scenes. */
  setCarriedUniverses(universes: number[]): void {
    this.carried = new Set(universes)
    for (const u of universes) this.dirty.add(u)
  }

  layerById(id: string): Layer | undefined {
    return this.layers.find((l) => l.id === id)
  }

  // ------------------------------------------------------------------ state

  isBlackout(): boolean {
    return this.blackout
  }
  setBlackout(on: boolean): void {
    if (this.blackout === on) return
    this.blackout = on
    this.markAllDirty()
    this.emit('change')
  }
  getGrandMaster(): number {
    return this.grandMaster
  }
  setGrandMaster(v: number): void {
    const nv = clamp(v, 0, 1)
    if (nv === this.grandMaster) return
    this.grandMaster = nv
    this.markAllDirty()
    this.emit('change')
  }

  universes(): number[] {
    const set = new Set<number>(this.carried)
    for (const i of this.instances) for (const u of i.frames.keys()) set.add(u)
    return [...set].sort((a, b) => a - b)
  }

  activeSummaries(): ActiveSceneSummary[] {
    return this.instances
      .filter((i) => !i.origin.test)
      .map((i) => ({
        instanceId: i.instanceId,
        sceneId: i.sceneId,
        sceneName: i.sceneName,
        layerId: i.layerId,
        simulatorName: i.simulatorName,
        startedAt: i.startedAt,
        holdUntil: i.holdUntil,
        releaseStartedAt: i.releaseStartedAt,
        kind: i.levelKey ? ('level' as const) : ('scene' as const),
        level: i.levelValue,
        floor: i.origin.floor === true
      }))
  }

  // ------------------------------------------------------------------ scenes

  /**
   * Resolve a scene to universe frames. Relative scenes need a simulator profile.
   * Returns overflow warnings (channels beyond 512 are dropped).
   */
  static resolveScene(
    scene: Scene,
    simulator: SimulatorProfile | null
  ): { frames: Map<number, Uint8Array>; masks: Map<number, Uint8Array>; warnings: string[] } {
    const frames = new Map<number, Uint8Array>()
    const masks = new Map<number, Uint8Array>()
    const warnings: string[] = []
    const set = (u: number, ch: number, v: number): void => {
      if (ch < 1 || ch > DMX_CHANNELS) {
        warnings.push(`Channel ${ch} on universe ${u} is out of range and was dropped`)
        return
      }
      if (!frames.has(u)) {
        frames.set(u, new Uint8Array(DMX_CHANNELS + 1))
        masks.set(u, new Uint8Array(DMX_CHANNELS + 1))
      }
      frames.get(u)![ch] = clamp(Math.round(v), 0, 255)
      masks.get(u)![ch] = 1
    }
    if (scene.addressing === 'absolute') {
      for (const e of scene.entries) set(e.universe ?? scene.defaultUniverse, e.channel, e.value)
    } else {
      if (!simulator) {
        warnings.push(`Scene "${scene.name}" is relative but no simulator was given`)
        return { frames, masks, warnings }
      }
      for (const e of scene.entries)
        set(simulator.universe, simulator.baseAddress + e.channel, e.value)
    }
    return { frames, masks, warnings }
  }

  activate(
    scene: Scene,
    simulator: SimulatorProfile | null,
    thoriumSimulatorId: string | null,
    opts: ActivateOptions = {}
  ): { instance: ActiveInstance | null; warnings: string[] } {
    const { frames, masks, warnings } = Compositor.resolveScene(scene, simulator)
    if (frames.size === 0) return { instance: null, warnings }
    const layerId = opts.layerId ?? scene.defaultLayerId
    if (!this.layerById(layerId)) {
      warnings.push(`Layer for scene "${scene.name}" not found`)
      return { instance: null, warnings }
    }
    const now = this.now()
    const simKey = simulator?.id ?? thoriumSimulatorId ?? null
    const existing = this.instances.find(
      (i) => i.sceneId === scene.id && i.layerId === layerId && (i.simulatorId ?? null) === simKey
    )
    // Replacement: restart fade-in from the current level so there is no dip.
    let startLevel = 0
    if (existing) {
      const lvl = envelopeLevel(existing, now)
      startLevel = lvl === DONE ? 0 : lvl
      this.instances = this.instances.filter((i) => i !== existing)
    }
    const holdMs =
      opts.holdMsOverride ?? (scene.behavior.kind === 'timed' ? scene.behavior.holdMs : null)
    const inst: ActiveInstance = {
      instanceId: existing?.instanceId ?? uuid(),
      sceneId: scene.id,
      sceneName: scene.name,
      layerId,
      simulatorId: simKey,
      simulatorName: simulator?.name ?? null,
      startedAt: now,
      fadeInMs: scene.fadeInMs,
      fadeOutMs: scene.fadeOutMs,
      startLevel,
      releaseStartedAt: null,
      releaseLevel: 1,
      holdUntil: holdMs != null ? now + scene.fadeInMs + holdMs : null,
      frames,
      masks,
      levelKey: null,
      fromFrames: null,
      valueFadeStartedAt: now,
      valueFadeMs: 0,
      levelValue: null,
      nextStage: null,
      origin: opts.origin ?? {}
    }
    this.instances.push(inst)
    for (const u of frames.keys()) this.dirty.add(u)
    this.emit('change')
    return { instance: inst, warnings }
  }

  release(pred: (i: ActiveInstance) => boolean): number {
    const now = this.now()
    let n = 0
    for (const i of this.instances) {
      if (i.releaseStartedAt != null || !pred(i)) continue
      const lvl = envelopeLevel(i, now)
      i.releaseLevel = lvl === DONE ? 0 : lvl
      i.releaseStartedAt = now
      n++
      for (const u of i.frames.keys()) this.dirty.add(u)
    }
    if (n) this.emit('change')
    return n
  }

  releaseScene(sceneId: string, simulatorKey: string | null | 'all'): number {
    return this.release(
      (i) =>
        i.sceneId === sceneId &&
        (simulatorKey === 'all' || (i.simulatorId ?? null) === simulatorKey)
    )
  }

  releaseLayer(layerId: string, simulatorKey: string | null | 'all' = 'all'): number {
    return this.release(
      (i) =>
        i.layerId === layerId &&
        !i.origin.test &&
        !i.origin.floor &&
        (simulatorKey === 'all' || (i.simulatorId ?? null) === simulatorKey)
    )
  }

  releaseAll(includeBase = false): number {
    return this.release(
      (i) => !i.origin.test && !i.origin.floor && (includeBase || i.layerId !== LAYER_IDS.base)
    )
  }

  /** Immediately drop instances (no fade). */
  drop(pred: (i: ActiveInstance) => boolean): void {
    const before = this.instances.length
    for (const i of this.instances) if (pred(i)) for (const u of i.frames.keys()) this.dirty.add(u)
    this.instances = this.instances.filter((i) => !pred(i))
    if (this.instances.length !== before) this.emit('change')
  }

  // ------------------------------------------------------------------ levels

  /**
   * Hold `channels` at `value`, creating the instance on first call and updating
   * it in place on every call after that (keyed by `key`). Unlike a scene
   * re-activation, a change crossfades the channel *values* from where they
   * currently are to the new ones, so a dimmer follow never dips through the
   * layer underneath.
   */
  setLevel(
    key: string,
    spec: {
      layerId: string
      universe: number
      channels: number[]
      value: number
      fadeMs: number
      label: string
      /**
       * Release the level automatically this long after the fade in settles
       * (the `holdLevel` action). Null or absent means it stays until released,
       * which is what a value follow wants.
       */
      holdMs?: number | null
      /** Where to go when that hold ends, instead of releasing. */
      nextStage?: LevelStage | null
      simulatorKey?: string | null
      simulatorName?: string | null
      origin?: ActiveInstance['origin']
    }
  ): { instance: ActiveInstance | null; warnings: string[] } {
    const warnings: string[] = []
    if (!this.layerById(spec.layerId)) {
      warnings.push(`Layer for level "${spec.label}" not found`)
      return { instance: null, warnings }
    }
    const now = this.now()
    const value = clamp(Math.round(spec.value), 0, 255)
    // Scenes start their hold once the fade in is done; a level's "fade in" is
    // its value ramp, so the same rule puts the hold after `fadeMs`.
    const holdUntil =
      spec.holdMs != null ? now + Math.max(0, spec.fadeMs) + Math.max(0, spec.holdMs) : null
    const frames = new Map<number, Uint8Array>()
    const masks = new Map<number, Uint8Array>()
    const f = new Uint8Array(DMX_CHANNELS + 1)
    const m = new Uint8Array(DMX_CHANNELS + 1)
    for (const ch of spec.channels) {
      if (ch < 1 || ch > DMX_CHANNELS) {
        warnings.push(`Channel ${ch} on universe ${spec.universe} is out of range and was dropped`)
        continue
      }
      f[ch] = value
      m[ch] = 1
    }
    if (!m.some((x) => x === 1)) return { instance: null, warnings }
    frames.set(spec.universe, f)
    masks.set(spec.universe, m)

    const existing = this.instances.find((i) => i.levelKey === key)
    if (existing) {
      // Start the new fade from what this instance is actually outputting right
      // now — a change part-way through a fade continues from there, not from
      // the value the last change was aiming at.
      const from = this.snapshotFrames(existing, now)
      existing.layerId = spec.layerId
      existing.sceneName = spec.label
      existing.simulatorName = spec.simulatorName ?? null
      existing.frames = frames
      existing.masks = masks
      existing.fromFrames = from
      existing.valueFadeStartedAt = now
      existing.valueFadeMs = Math.max(0, spec.fadeMs)
      existing.fadeOutMs = Math.max(0, spec.fadeMs)
      existing.levelValue = value
      // Re-firing the same action re-arms the hold from now, so a repeating
      // event keeps the channels up rather than letting the first hold expire,
      // and puts the fallback stage back in front of it.
      existing.holdUntil = holdUntil
      existing.nextStage = spec.nextStage ?? null
      if (spec.origin) existing.origin = spec.origin
      // A level that was released and is being driven again comes back to life.
      existing.releaseStartedAt = null
      existing.releaseLevel = 1
      this.dirty.add(spec.universe)
      this.emit('change')
      return { instance: existing, warnings }
    }

    const inst: ActiveInstance = {
      instanceId: uuid(),
      sceneId: key,
      sceneName: spec.label,
      layerId: spec.layerId,
      simulatorId: spec.simulatorKey ?? null,
      simulatorName: spec.simulatorName ?? null,
      startedAt: now,
      fadeInMs: 0,
      fadeOutMs: Math.max(0, spec.fadeMs),
      startLevel: 1,
      releaseStartedAt: null,
      releaseLevel: 1,
      holdUntil,
      frames,
      masks,
      levelKey: key,
      // A brand-new level ramps its value from whatever those channels show
      // right now (0 when nothing drives them), so taking over from a floor or
      // a scene underneath never dips through black first.
      fromFrames: new Map([[spec.universe, this.currentValues(spec.universe, m)]]),
      valueFadeStartedAt: now,
      valueFadeMs: Math.max(0, spec.fadeMs),
      levelValue: value,
      nextStage: spec.nextStage ?? null,
      origin: spec.origin ?? {}
    }
    this.instances.push(inst)
    this.dirty.add(spec.universe)
    this.emit('change')
    return { instance: inst, warnings }
  }

  /**
   * The composited value (before Grand Master and blackout) of the channels in
   * `mask` on `universe` right now, for a new level to start its fade from.
   */
  private currentValues(universe: number, mask: Uint8Array): Uint8Array {
    const values = this.composite(universe, this.now()).values
    const out = new Uint8Array(DMX_CHANNELS + 1)
    for (let ch = 1; ch <= DMX_CHANNELS; ch++)
      if (mask[ch]) out[ch] = clamp(Math.round(values[ch]), 0, 255)
    return out
  }

  /**
   * What an instance is outputting right this moment, per universe — the value
   * a new fade has to start from so a change mid-fade never jumps.
   */
  private snapshotFrames(i: ActiveInstance, now: number): Map<number, Uint8Array> {
    const from = new Map<number, Uint8Array>()
    for (const [u, arr] of i.frames) {
      const snapshot = new Uint8Array(DMX_CHANNELS + 1)
      for (let ch = 1; ch <= DMX_CHANNELS; ch++)
        if (arr[ch] || i.masks.get(u)![ch]) snapshot[ch] = Math.round(instanceValue(i, u, ch, now))
      from.set(u, snapshot)
      this.dirty.add(u)
    }
    return from
  }

  /**
   * Move a held level to its follow-on value when the first hold runs out: same
   * channels, same layer, new value, and a fresh hold (or none, which leaves it
   * up until something releases it). Crossfades like any other level change.
   */
  private applyStage(i: ActiveInstance, stage: LevelStage, now: number): void {
    const value = clamp(Math.round(stage.value), 0, 255)
    const fadeMs = Math.max(0, stage.fadeMs)
    const from = this.snapshotFrames(i, now)
    const frames = new Map<number, Uint8Array>()
    for (const [u, mask] of i.masks) {
      const f = new Uint8Array(DMX_CHANNELS + 1)
      for (let ch = 1; ch <= DMX_CHANNELS; ch++) if (mask[ch]) f[ch] = value
      frames.set(u, f)
    }
    i.frames = frames
    i.fromFrames = from
    i.valueFadeStartedAt = now
    i.valueFadeMs = fadeMs
    i.fadeOutMs = fadeMs
    i.levelValue = value
    i.holdUntil = stage.holdMs != null ? now + fadeMs + Math.max(0, stage.holdMs) : null
    // One step per firing: without this the same stage would re-apply every
    // time its own hold expired.
    i.nextStage = null
  }

  // ------------------------------------------------------------------ test layer

  private testInstance: ActiveInstance | null = null

  setTestChannel(universe: number, channel: number, value: number | null): void {
    if (!this.testInstance) {
      this.testInstance = {
        instanceId: 'test',
        sceneId: 'test',
        sceneName: 'Channel tester',
        layerId: LAYER_IDS.test,
        simulatorId: null,
        simulatorName: null,
        startedAt: this.now(),
        fadeInMs: 0,
        fadeOutMs: 0,
        startLevel: 1,
        releaseStartedAt: null,
        releaseLevel: 1,
        holdUntil: null,
        frames: new Map(),
        masks: new Map(),
        levelKey: null,
        fromFrames: null,
        valueFadeStartedAt: this.now(),
        valueFadeMs: 0,
        levelValue: null,
        nextStage: null,
        origin: { test: true }
      }
      this.instances.push(this.testInstance)
    }
    const t = this.testInstance
    if (!t.frames.has(universe)) {
      t.frames.set(universe, new Uint8Array(DMX_CHANNELS + 1))
      t.masks.set(universe, new Uint8Array(DMX_CHANNELS + 1))
    }
    if (value == null) {
      t.frames.get(universe)![channel] = 0
      t.masks.get(universe)![channel] = 0
    } else {
      t.frames.get(universe)![channel] = clamp(Math.round(value), 0, 255)
      t.masks.get(universe)![channel] = 1
    }
    this.dirty.add(universe)
    this.emit('change')
  }

  clearTest(): void {
    if (!this.testInstance) return
    for (const u of this.testInstance.frames.keys()) this.dirty.add(u)
    this.instances = this.instances.filter((i) => i !== this.testInstance)
    this.testInstance = null
    this.emit('change')
  }

  // ------------------------------------------------------------------ tick

  /**
   * Advance time: expire timed instances, drop finished fades. Returns true if any
   * instance changed state (for snapshot pushes).
   */
  tick(): boolean {
    const now = this.now()
    let changed = false
    for (const i of this.instances) {
      if (i.holdUntil != null && i.releaseStartedAt == null && now >= i.holdUntil) {
        if (i.nextStage) {
          // A held level with a fallback steps down to it instead of releasing.
          this.applyStage(i, i.nextStage, now)
        } else {
          const lvl = envelopeLevel(i, now)
          i.releaseLevel = lvl === DONE ? 0 : lvl
          i.releaseStartedAt = now
        }
        changed = true
      }
      if (i.fromFrames && valueFadeT(i, now) >= 1) {
        // The value fade just settled: drop the interpolation source and render
        // once more, or the cached frame would keep serving the last step.
        i.fromFrames = null
        for (const u of i.frames.keys()) this.dirty.add(u)
      }
      if (envelopeIsAnimating(i, now) || valueFadeT(i, now) < 1)
        for (const u of i.frames.keys()) this.dirty.add(u)
    }
    const before = this.instances.length
    this.instances = this.instances.filter((i) => {
      const done = envelopeLevel(i, now) === DONE
      if (done) for (const u of i.frames.keys()) this.dirty.add(u)
      return !done
    })
    if (this.instances.length !== before) changed = true
    if (changed) this.emit('change')
    return changed
  }

  isDirty(universe: number): boolean {
    return this.dirty.has(universe)
  }

  /** Render (or return cached) frame for a universe. */
  frame(universe: number): ResolvedFrame {
    if (!this.dirty.has(universe) && this.cache.has(universe)) return this.cache.get(universe)!
    const rendered = this.render(universe)
    this.cache.set(universe, rendered)
    this.dirty.delete(universe)
    return rendered
  }

  private render(universe: number): ResolvedFrame {
    const { values, owners } = this.composite(universe, this.now())
    const out = new Uint8Array(DMX_CHANNELS + 1)
    if (!this.blackout) {
      for (let ch = 1; ch <= DMX_CHANNELS; ch++) {
        out[ch] = clamp(Math.round(values[ch] * this.grandMaster), 0, 255)
      }
    }
    return { values: out, owners }
  }

  /** Layer the instances for one universe (before Grand Master and blackout). */
  private composite(
    universe: number,
    now: number
  ): { values: Float32Array; owners: (string | null)[] } {
    const values = new Float32Array(DMX_CHANNELS + 1)
    const owners: (string | null)[] = new Array(DMX_CHANNELS + 1).fill(null)
    for (const layer of this.layers) {
      const inLayer = this.instances.filter((i) => i.layerId === layer.id && i.frames.has(universe))
      if (inLayer.length === 0) continue
      // Latest activation wins within a layer (LTP)
      inLayer.sort((a, b) => a.startedAt - b.startedAt)
      for (let ch = 1; ch <= DMX_CHANNELS; ch++) {
        let winner: ActiveInstance | null = null
        for (let k = inLayer.length - 1; k >= 0; k--) {
          if (inLayer[k].masks.get(universe)![ch]) {
            winner = inLayer[k]
            break
          }
        }
        if (!winner) continue
        let e = envelopeLevel(winner, now)
        if (e === DONE) e = 0
        const v = instanceValue(winner, universe, ch, now)
        values[ch] = values[ch] * (1 - e) + v * e
        if (e > 0) owners[ch] = winner.instanceId
      }
    }
    return { values, owners }
  }

  private markAllDirty(): void {
    for (const u of this.universes()) this.dirty.add(u)
    for (const u of this.cache.keys()) this.dirty.add(u)
  }

  /** Snapshot of instances for diagnostics/tests. */
  getInstances(): readonly ActiveInstance[] {
    return this.instances
  }
}
