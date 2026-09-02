/**
 * GraphQL operation strings. Field names verified against thorium/src/schema.graphql.
 * Handlers must tolerate missing fields because the Thorium schema evolves.
 */

export const SUB_EVENTS = `subscription LightingEvents { events }`

/**
 * Every flight, not just running ones: Thorium's `pause()` sets `running = false`, so a
 * `running: true` filter would make a paused flight vanish and look like it ended (and would
 * drop this client's assignment). That filter is also only applied to the subscription's first
 * payload, so filtering server-side would be inconsistent anyway.
 */
export const SUB_FLIGHTS = `subscription LightingFlights {
  flightsUpdate { id name date running simulators { id name alertlevel training } }
}`

export const SUB_CLIENT = `subscription LightingClient($clientId: ID) {
  clientChanged(clientId: $clientId) {
    id label connected
    flight { id name running }
    simulator { id name }
    station { name }
  }
}`

export const SUB_SIMULATOR = `subscription LightingSimulator($simulatorId: ID) {
  simulatorsUpdate(simulatorId: $simulatorId) {
    id name alertlevel alertLevelLock training
    lighting { intensity action actionStrength transitionDuration }
  }
}`

export const SUB_REACTOR = `subscription LightingReactor($simulatorId: ID) {
  reactorUpdate(simulatorId: $simulatorId) {
    id name displayName model powerOutput efficiency batteryChargeLevel batteryChargeRate depletion ejected externalPower heat
  }
}`

export const SUB_SYSTEMS = `subscription LightingSystems($simulatorId: ID) {
  systemsUpdate(simulatorId: $simulatorId, power: true) {
    id name displayName type
    power { power powerLevels }
    damage { damaged destroyed }
  }
}`

export const SUB_SHIELDS = `subscription LightingShields($simulatorId: ID) {
  shieldsUpdate(simulatorId: $simulatorId) { id state integrity position }
}`

export const SUB_STEALTH = `subscription LightingStealth($simulatorId: ID) {
  stealthFieldUpdate(simulatorId: $simulatorId) { id state charge }
}`

export const SUB_MACROS = `subscription LightingMacros { macrosUpdate { id name } }`
export const SUB_MACRO_BUTTONS = `subscription LightingMacroButtons { macroButtonsUpdate { id name buttons { id name category } } }`
export const SUB_MISSIONS = `subscription LightingMissions { missionsUpdate { id name timeline { id name timelineItems { id name event } } } }`

/** Liveness / round-trip probe. Thorium exposes no version field, so this asks for the server id. */
export const Q_VERSION = `query LightingIdentity { thorium { thoriumId } }`

export const Q_PROBE = `query LightingProbe {
  thorium { thoriumId }
  flights { id name date running simulators { id name alertlevel training } }
}`

export const Q_REFDATA = `query LightingRefData {
  macros { id name }
  macroButtons { id name buttons { id name category } }
  missions { id name timeline { id name timelineItems { id name event } } }
  flights { id name date running simulators { id name alertlevel training } }
}`

export const Q_CLIENT = `query LightingClientState($clientId: ID) {
  clients(clientId: $clientId) {
    id label connected
    flight { id name running }
    simulator { id name }
    station { name }
  }
}`

export const M_CLIENT_CONNECT = `mutation LightingClientConnect($client: ID!, $label: String) { clientConnect(client: $client, label: $label) }`
export const M_CLIENT_DISCONNECT = `mutation LightingClientDisconnect($client: ID!) { clientDisconnect(client: $client) }`
export const M_TRIGGER_MACRO = `mutation LightingTriggerMacro($simulatorId: ID!, $macroId: ID!) { triggerMacroAction(simulatorId: $simulatorId, macroId: $macroId) }`
export const M_SET_ALERT = `mutation LightingSetAlert($simulatorId: ID!, $alertLevel: String!) { changeSimulatorAlertLevel(simulatorId: $simulatorId, alertLevel: $alertLevel) }`
export const M_NOTIFY = `mutation LightingNotify($simulatorId: ID!, $title: String!, $body: String, $color: NotifyColors) { notify(simulatorId: $simulatorId, title: $title, body: $body, color: $color, station: "Core") }`

// ---------------------------------------------------------------------------
// Result shapes (loosely typed; everything optional)
// ---------------------------------------------------------------------------

export interface GqlSimulator {
  id: string
  name?: string | null
  alertlevel?: string | null
  alertLevelLock?: boolean | null
  training?: boolean | null
  lighting?: {
    intensity?: number | null
    action?: string | null
    actionStrength?: number | null
    transitionDuration?: number | null
  } | null
}
export interface GqlFlight {
  id: string
  name?: string | null
  date?: string | null
  running?: boolean | null
  simulators?: GqlSimulator[] | null
}
export interface GqlClient {
  id: string
  label?: string | null
  connected?: boolean | null
  flight?: { id: string; name?: string | null; running?: boolean | null } | null
  simulator?: { id: string; name?: string | null } | null
  station?: { name?: string | null } | null
}
export interface GqlReactor {
  id: string
  name?: string | null
  displayName?: string | null
  model?: string | null
  powerOutput?: number | null
  efficiency?: number | null
  batteryChargeLevel?: number | null
  batteryChargeRate?: number | null
  depletion?: number | null
  ejected?: boolean | null
  externalPower?: boolean | null
  heat?: number | null
}
export interface GqlSystem {
  id: string
  name?: string | null
  displayName?: string | null
  type?: string | null
  power?: { power?: number | null; powerLevels?: number[] | null } | null
  damage?: { damaged?: boolean | null; destroyed?: boolean | null } | null
}
export interface GqlShield {
  id: string
  state?: boolean | null
  integrity?: number | null
  position?: number | null
}
export interface GqlStealth {
  id: string
  state?: boolean | null
  charge?: boolean | null
}
export interface GqlRefData {
  macros?: { id: string; name?: string | null }[] | null
  macroButtons?:
    | {
        id: string
        name?: string | null
        buttons?: { id: string; name?: string | null; category?: string | null }[] | null
      }[]
    | null
  missions?:
    | {
        id: string
        name?: string | null
        timeline?:
          | {
              id: string
              name?: string | null
              timelineItems?: { id: string; name?: string | null; event?: string | null }[] | null
            }[]
          | null
      }[]
    | null
  flights?: GqlFlight[] | null
}
