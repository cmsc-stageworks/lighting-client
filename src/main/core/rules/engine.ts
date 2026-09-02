import type { Mapping } from '@shared/types/config'
import type { AppEvent } from '@shared/types/events'
import type { ReferenceData } from '@shared/types/state'
import { compile, matchEvent, type CompiledTrigger } from '@shared/triggers/matcher'
import { getLogger } from '../../logging'
import type { ActionRunner } from './actions'

const log = getLogger('rules')

interface CompiledMapping {
  mapping: Mapping
  compiled: CompiledTrigger
}

export class RulesEngine {
  private compiled: CompiledMapping[] = []
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
        compiled: compile(mapping.trigger, { refData: this.refData })
      }))
    const unresolved = this.compiled.filter((c) => c.compiled.unresolved)
    if (unresolved.length)
      log.debug(
        `unresolved triggers: ${unresolved.map((u) => `${u.mapping.name}: ${u.compiled.unresolved}`).join(' | ')}`
      )
  }

  unresolved(): { mappingId: string; reason: string }[] {
    return this.compiled
      .filter((c) => c.compiled.unresolved)
      .map((c) => ({ mappingId: c.mapping.id, reason: c.compiled.unresolved! }))
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
      if (!matchEvent(compiled, event)) continue
      if (mapping.debounceMs > 0) {
        const last = this.lastFired.get(mapping.id) ?? 0
        if (now - last < mapping.debounceMs) continue
      }
      this.lastFired.set(mapping.id, now)
      const s = this.stats.get(mapping.id) ?? { lastFiredAt: null, count: 0 }
      s.lastFiredAt = now
      s.count++
      this.stats.set(mapping.id, s)
      event.matchedMappingIds.push(mapping.id)
      void this.runner.run(mapping, event)
    }
  }

  /** Dry-run: which mappings would match (no actions, no stats). */
  evaluate(event: AppEvent): Mapping[] {
    return this.compiled
      .filter(({ compiled }) => !compiled.unresolved && matchEvent(compiled, event))
      .map((c) => c.mapping)
  }
}
