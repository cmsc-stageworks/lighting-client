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
  origin: { mappingId?: string; eventId?: string; ui?: boolean; test?: boolean }
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
        releaseStartedAt: i.releaseStartedAt
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
        (simulatorKey === 'all' || (i.simulatorId ?? null) === simulatorKey)
    )
  }

  releaseAll(includeBase = false): number {
    return this.release((i) => !i.origin.test && (includeBase || i.layerId !== LAYER_IDS.base))
  }

  /** Immediately drop instances (no fade). */
  drop(pred: (i: ActiveInstance) => boolean): void {
    const before = this.instances.length
    for (const i of this.instances) if (pred(i)) for (const u of i.frames.keys()) this.dirty.add(u)
    this.instances = this.instances.filter((i) => !pred(i))
    if (this.instances.length !== before) this.emit('change')
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
        const lvl = envelopeLevel(i, now)
        i.releaseLevel = lvl === DONE ? 0 : lvl
        i.releaseStartedAt = now
        changed = true
      }
      if (envelopeIsAnimating(i, now)) for (const u of i.frames.keys()) this.dirty.add(u)
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
    const now = this.now()
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
        const v = winner.frames.get(universe)![ch]
        values[ch] = values[ch] * (1 - e) + v * e
        if (e > 0) owners[ch] = winner.instanceId
      }
    }
    const out = new Uint8Array(DMX_CHANNELS + 1)
    if (!this.blackout) {
      for (let ch = 1; ch <= DMX_CHANNELS; ch++) {
        out[ch] = clamp(Math.round(values[ch] * this.grandMaster), 0, 255)
      }
    }
    return { values: out, owners }
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
