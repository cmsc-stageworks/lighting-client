import type { Action, Mapping } from '@shared/types/config'
import type { AppEvent } from '@shared/types/events'
import type { ReferenceData } from '@shared/types/state'
import { compileMapping, matchMapping, type CompiledMapping } from '@shared/triggers/matcher'
import { gateAction, gateRequestForAction, type LightingMode } from '@shared/lightingMode'
import { getLogger } from '../../logging'
import type { ActionRunner } from './actions'

const log = getLogger('rules')

interface CompiledEntry {
  mapping: Mapping
  compiled: CompiledMapping
}

export interface ModeGate {
  mode: () => LightingMode
  /** called once per mapping that had actions held back */
  onHeldBack: (text: string) => void
}

export interface GatedActions {
  allowed: Action[]
  heldBack: { action: string; reason: string }[]
}

const NORMAL_GATE: ModeGate = { mode: () => 'normal', onHeldBack: () => undefined }

export class RulesEngine {
  private compiled: CompiledEntry[] = []
  private lastFired = new Map<string, number>()
  private stats = new Map<string, { lastFiredAt: number | null; count: number }>()
  private refData: ReferenceData | null = null
  private mappings: Mapping[] = []

  constructor(
    private runner: ActionRunner,
    private gate: ModeGate = NORMAL_GATE
  ) {}

  /** Split a mapping's actions into what the lighting mode allows for this event. */
  gateActions(mapping: Mapping, event: AppEvent): GatedActions {
    const mode = this.gate.mode()
    const out: GatedActions = { allowed: [], heldBack: [] }
    for (const action of mapping.actions) {
      const reason = gateAction(
        mode,
        gateRequestForAction(action, (id) => this.runner.sceneById(id)),
        { staffOrigin: event.staffOrigin === true }
      )
      if (reason) out.heldBack.push({ action: this.runner.describe(action), reason })
      else out.allowed.push(action)
    }
    return out
  }

  setMappings(mappings: Mapping[]): void {
    this.mappings = mappings
    this.recompile()
  }

  setReferenceData(ref: ReferenceData | null): void {
    this.refData = ref
    this.recompile()
  }

  private recompile(): void {
    this.compiled = this.mappings
      .filter((m) => m.enabled)
      .map((mapping) => ({
        mapping,
        compiled: compileMapping(mapping, { refData: this.refData })
      }))
    const unresolved = this.unresolved()
    if (unresolved.length)
      log.debug(
        `unresolved triggers: ${unresolved
          .map(
            (u) =>
              `${this.mappings.find((m) => m.id === u.mappingId)?.name}: ${u.reason}${u.fatal ? '' : ' (other triggers still fire)'}`
          )
          .join(' | ')}`
      )
  }

  /**
   * Mappings whose triggers cannot resolve. `fatal` means no trigger can fire;
   * otherwise only some of a multi-trigger mapping's alternatives are dead.
   */
  unresolved(): { mappingId: string; reason: string; fatal: boolean }[] {
    const out: { mappingId: string; reason: string; fatal: boolean }[] = []
    for (const c of this.compiled) {
      if (c.compiled.unresolved)
        out.push({ mappingId: c.mapping.id, reason: c.compiled.unresolved, fatal: true })
      else if (c.compiled.partial)
        out.push({ mappingId: c.mapping.id, reason: c.compiled.partial, fatal: false })
    }
    return out
  }

  statsSnapshot(): Record<string, { lastFiredAt: number | null; count: number }> {
    const out: Record<string, { lastFiredAt: number | null; count: number }> = {}
    for (const [k, v] of this.stats) out[k] = v
    return out
  }

  /** Evaluate an event, mutate `event.matchedMappingIds`, and run actions. */
  onEvent(event: AppEvent): void {
    const now = Date.now()
    for (const { mapping, compiled } of this.compiled) {
      if (compiled.unresolved) continue
      if (!matchMapping(compiled, event)) continue
      if (mapping.debounceMs > 0) {
        const last = this.lastFired.get(mapping.id) ?? 0
        if (now - last < mapping.debounceMs) {
          ;(event.trace ??= []).push({
            mappingId: mapping.id,
            mappingName: mapping.name,
            actions: [],
            debounced: true
          })
          continue
        }
      }
      const { allowed, heldBack } = this.gateActions(mapping, event)
      if (heldBack.length) this.gate.onHeldBack(`${mapping.name} — ${heldBack[0].reason}`)
      if (allowed.length === 0 && heldBack.length > 0) {
        // Everything was held back: record why, but it did not fire.
        ;(event.trace ??= []).push({
          mappingId: mapping.id,
          mappingName: mapping.name,
          actions: [],
          heldBack
        })
        continue
      }
      this.lastFired.set(mapping.id, now)
      const s = this.stats.get(mapping.id) ?? { lastFiredAt: null, count: 0 }
      s.lastFiredAt = now
      s.count++
      this.stats.set(mapping.id, s)
      event.matchedMappingIds.push(mapping.id)
      ;(event.trace ??= []).push({
        mappingId: mapping.id,
        mappingName: mapping.name,
        actions: allowed.map((a) => this.runner.describe(a)),
        ...(heldBack.length ? { heldBack } : {})
      })
      void this.runner.run(mapping, event, allowed)
    }
  }

  /** Dry-run: which mappings would match and what the lighting mode would allow (no actions, no stats). */
  evaluate(event: AppEvent): ({ mapping: Mapping } & GatedActions)[] {
    return this.compiled
      .filter(({ compiled }) => !compiled.unresolved && matchMapping(compiled, event))
      .map((c) => ({ mapping: c.mapping, ...this.gateActions(c.mapping, event) }))
  }
}
