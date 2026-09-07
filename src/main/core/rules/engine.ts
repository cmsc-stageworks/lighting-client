import type { Mapping } from '@shared/types/config'
import type { AppEvent } from '@shared/types/events'
import type { ReferenceData } from '@shared/types/state'
import { compileMapping, matchMapping, type CompiledMapping } from '@shared/triggers/matcher'
import { getLogger } from '../../logging'
import type { ActionRunner } from './actions'

const log = getLogger('rules')

interface CompiledEntry {
  mapping: Mapping
  compiled: CompiledMapping
}

export class RulesEngine {
  private compiled: CompiledEntry[] = []
  private lastFired = new Map<string, number>()
  private stats = new Map<string, { lastFiredAt: number | null; count: number }>()
  private refData: ReferenceData | null = null
  private mappings: Mapping[] = []

  constructor(private runner: ActionRunner) {}

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
      this.lastFired.set(mapping.id, now)
      const s = this.stats.get(mapping.id) ?? { lastFiredAt: null, count: 0 }
      s.lastFiredAt = now
      s.count++
      this.stats.set(mapping.id, s)
      event.matchedMappingIds.push(mapping.id)
      ;(event.trace ??= []).push({
        mappingId: mapping.id,
        mappingName: mapping.name,
        actions: mapping.actions.map((a) => this.runner.describe(a))
      })
      void this.runner.run(mapping, event)
    }
  }

  /** Dry-run: which mappings would match (no actions, no stats). */
  evaluate(event: AppEvent): Mapping[] {
    return this.compiled
      .filter(({ compiled }) => !compiled.unresolved && matchMapping(compiled, event))
      .map((c) => c.mapping)
  }
}
