export type EventSource = 'thorium' | 'mqtt' | 'ui' | 'system'

/**
 * Normalized event flowing through the main-process EventBus.
 *
 * `type` is a coarse category (see ERD §5.1), `name` is the fine-grained identifier
 * (Thorium event name, MQTT topic, UI action, derived state event name) and `data`
 * is what trigger conditions resolve their paths against.
 */
export interface AppEvent {
  id: string
  ts: number
  source: EventSource
  type: EventType
  name: string
  simulatorId?: string
  simulatorName?: string
  data: Record<string, unknown>
  matchedMappingIds: string[]
}

export type EventType = 'thorium.event' | 'thorium.state' | 'mqtt.message' | 'ui.action' | 'system'

export const EVENT_TYPES: EventType[] = [
  'thorium.event',
  'thorium.state',
  'mqtt.message',
  'ui.action',
  'system'
]

/** Derived Thorium state event names produced by sources/thorium/derived.ts */
export const DERIVED_EVENT_NAMES = [
  'alertLevel.changed',
  'training.changed',
  'lighting.actionChanged',
  'lighting.intensityChanged',
  'battery.below',
  'battery.above',
  'reactor.ejected',
  'reactor.restored',
  'reactor.externalPowerOn',
  'reactor.externalPowerOff',
  'reactor.heatAbove',
  'reactor.heatBelow',
  'power.outputChanged',
  'power.totalDrawChanged',
  'system.damaged',
  'system.repaired',
  'system.powerChanged',
  'flight.started',
  'flight.paused',
  'flight.resumed',
  'flight.reset',
  'flight.ended',
  'shields.raised',
  'shields.lowered',
  'stealth.changed',
  'client.assigned'
] as const
export type DerivedEventName = (typeof DERIVED_EVENT_NAMES)[number]

export interface MqttMessageRecord {
  ts: number
  topic: string
  payload: string
  qos: number
  retain: boolean
}
