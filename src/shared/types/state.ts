export type ConnState = 'disabled' | 'connecting' | 'connected' | 'reconnecting' | 'error'

export interface OutputHealth {
  state: 'disabled' | 'starting' | 'ok' | 'error'
  reason?: string
  fps: number
  lastSendAt: number | null
  detail?: string
}

export interface SimulatorInScope {
  id: string
  name: string
  alertLevel: string | null
  training: boolean
  flightId: string
  flightName: string | null
  /** Profile id if a SimulatorProfile with the same name exists */
  profileId: string | null
}

export interface ThoriumRuntime {
  state: ConnState
  reason?: string
  serverId?: string
  /** the flight this client is assigned to (null when unassigned) */
  flight?: { id: string; name: string; running: boolean } | null
  /** every running flight Thorium reports */
  flights: { id: string; name: string; running: boolean; simulators: string[] }[]
  simulatorsInScope: SimulatorInScope[]
  assignment: {
    flightId: string | null
    flight: string | null
    simulatorId: string | null
    simulator: string | null
    station: string | null
  } | null
  /** scope mode waits for an FD assignment and none is present */
  waitingForAssignment: boolean
  scopeWarnings: string[]
  rttMs?: number | null
  eventsPerSec: number
  reconnects: number
  since: number | null
}

export interface MqttRuntime {
  state: ConnState
  reason?: string
  connectedSince?: number | null
  subscriptions: { topic: string; count: number }[]
  messagesPerSec: number
  reconnects: number
}

export interface ActiveSceneSummary {
  instanceId: string
  sceneId: string
  sceneName: string
  layerId: string
  simulatorName: string | null
  startedAt: number
  holdUntil: number | null
  releaseStartedAt: number | null
}

export interface CompositorRuntime {
  blackout: boolean
  grandMaster: number
  active: ActiveSceneSummary[]
  universes: number[]
}

export interface RuntimeSnapshot {
  ts: number
  thorium: ThoriumRuntime
  mqtt: MqttRuntime
  outputs: Record<string, OutputHealth>
  compositor: CompositorRuntime
  mappingsStats: Record<string, { lastFiredAt: number | null; count: number }>
  /** mappingId → reason the trigger cannot currently match (e.g. macro name not found) */
  unresolvedMappings: Record<string, string>
  alertOverrides: Record<string, string>
}

export interface SerialDeviceInfo {
  path: string
  manufacturer: string | null
  serialNumber: string | null
  vendorId: string | null
  productId: string | null
  friendlyName: string
}

export interface NetworkInterfaceInfo {
  name: string
  address: string
  family: string
  internal: boolean
}

export interface TestStep {
  name: string
  ok: boolean
  detail?: string
}
export interface TestReport {
  ok: boolean
  steps: TestStep[]
  durationMs: number
}

export interface ThoriumTestReport extends TestReport {
  serverId?: string
  rttMs?: number
  flight?: { id: string; name: string } | null
  simulators?: { id: string; name: string; alertLevel: string | null }[]
  assignment?: {
    flightId: string | null
    flight: string | null
    simulatorId: string | null
    simulator: string | null
    station: string | null
  } | null
}

export interface MqttTestReport extends TestReport {
  broker?: string
}

export interface ThoriumProbeResult {
  ok: boolean
  error?: string
  serverId?: string
  flights: {
    id: string
    name: string
    running: boolean
    simulators: { id: string; name: string; alertLevel: string | null }[]
  }[]
}

export interface ReferenceData {
  fetchedAt: number | null
  macros: { id: string; name: string }[]
  macroButtonConfigs: {
    id: string
    name: string
    buttons: { id: string; name: string; category: string | null }[]
  }[]
  missions: {
    id: string
    name: string
    timeline: { id: string; name: string; items: { id: string; name: string; event: string }[] }[]
  }[]
  simulators: { id: string; name: string }[]
  /** Event names observed on the firehose, most recent first (for autocomplete) */
  seenEventNames: string[]
  /** Mutation names from the schema catalog bundled with the app */
  knownEventNames: string[]
}

export interface SimulateReport {
  event: { type: string; name: string; simulatorName: string | null; data: Record<string, unknown> }
  matched: { mappingId: string; mappingName: string; actions: string[] }[]
  frames: { universe: number; changed: { channel: number; value: number }[] }[]
  live: boolean
}

export interface ImportPreview {
  token: string
  kind: 'all' | 'partial'
  summary: { added: Record<string, number>; updated: Record<string, number> }
  warnings: string[]
}
