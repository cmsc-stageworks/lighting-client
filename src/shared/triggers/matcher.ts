import type { ConditionNode, Trigger } from '../schema/config.schema'
import type { AppEvent, EventType } from '../types/events'
import { eqIgnoreCase } from '../utils'
import { evalConditions } from './conditions'
import { compileTrigger, type CompileContext } from './catalog'

export interface CompiledTrigger {
  types: EventType[]
  /** exact names (case-sensitive for Thorium event names, MQTT topics are matched via conditions) */
  names?: string[]
  conditions: ConditionNode[]
  /** true when the preset could not resolve a reference (e.g. macro name not found) */
  unresolved?: string
}

/** A mapping's triggers are ORed; the simulator restriction applies to all of them. */
export interface CompiledMapping {
  triggers: CompiledTrigger[]
  /** empty = any simulator */
  simulatorNames: string[]
  /** set when *no* trigger can fire — the mapping is dead until it is fixed */
  unresolved?: string
  /** set when some but not all triggers are unresolved — the rest still fire */
  partial?: string
}

export function compile(trigger: Trigger, ctx: CompileContext): CompiledTrigger {
  const base = compileTrigger(trigger.preset, trigger.params, ctx)
  return {
    types: base.types,
    names: base.names,
    conditions: [...base.conditions, ...trigger.conditions],
    unresolved: base.unresolved
  }
}

export function compileMapping(
  mapping: { triggers: Trigger[]; simulatorNames: string[] },
  ctx: CompileContext
): CompiledMapping {
  const triggers = mapping.triggers.map((t) => compile(t, ctx))
  const bad = triggers
    .map((t, i) => (t.unresolved ? `trigger ${i + 1}: ${t.unresolved}` : null))
    .filter((x): x is string => x !== null)
  const out: CompiledMapping = { triggers, simulatorNames: mapping.simulatorNames ?? [] }
  if (bad.length === 0) return out
  if (bad.length === triggers.length) out.unresolved = bad.join('; ')
  else out.partial = bad.join('; ')
  return out
}

/** Type / name / condition match for one trigger — the simulator check lives on the mapping. */
export function matchTrigger(compiled: CompiledTrigger, event: AppEvent): boolean {
  if (compiled.unresolved) return false
  if (!compiled.types.includes(event.type)) return false
  if (compiled.names && compiled.names.length > 0 && !compiled.names.includes(event.name))
    return false
  return evalConditions(compiled.conditions, event.data)
}

export function matchMapping(compiled: CompiledMapping, event: AppEvent): boolean {
  if (compiled.simulatorNames.length > 0) {
    if (!event.simulatorName) return false
    const sim = event.simulatorName
    if (!compiled.simulatorNames.some((n) => eqIgnoreCase(n, sim))) return false
  }
  return compiled.triggers.some((t) => matchTrigger(t, event))
}
