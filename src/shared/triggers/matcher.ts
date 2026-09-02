import type { Condition, Trigger } from '../schema/config.schema'
import type { AppEvent, EventType } from '../types/events'
import { eqIgnoreCase } from '../utils'
import { evalConditions } from './conditions'
import { compileTrigger, type CompileContext } from './catalog'

export interface CompiledTrigger {
  types: EventType[]
  /** exact names (case-sensitive for Thorium event names, MQTT topics are matched via conditions) */
  names?: string[]
  conditions: Condition[]
  /** empty = any simulator */
  simulatorNames: string[]
  /** true when the preset could not resolve a reference (e.g. macro name not found) */
  unresolved?: string
}

export function compile(trigger: Trigger, ctx: CompileContext): CompiledTrigger {
  const base = compileTrigger(trigger.preset, trigger.params, ctx)
  return {
    types: base.types,
    names: base.names,
    conditions: [...base.conditions, ...trigger.conditions],
    simulatorNames: trigger.simulatorNames ?? [],
    unresolved: base.unresolved
  }
}

export function matchEvent(compiled: CompiledTrigger, event: AppEvent): boolean {
  if (!compiled.types.includes(event.type)) return false
  if (compiled.names && compiled.names.length > 0 && !compiled.names.includes(event.name))
    return false
  if (compiled.simulatorNames.length > 0) {
    if (!event.simulatorName) return false
    const sim = event.simulatorName
    if (!compiled.simulatorNames.some((n) => eqIgnoreCase(n, sim))) return false
  }
  return evalConditions(compiled.conditions, event.data)
}
