import type {
  GqlFlight,
  GqlReactor,
  GqlShield,
  GqlSimulator,
  GqlStealth,
  GqlSystem
} from './operations'

/**
 * Turns Thorium state subscriptions into change events (ERD §8.3). Pure: callers
 * pass the previous snapshot and get back the events to emit plus the new snapshot.
 */

export interface DerivedEvent {
  name: string
  simulatorId?: string
  data: Record<string, unknown>
}

export interface SimState {
  alertLevel: string | null
  training: boolean
  effectiveLevel: string | null
  lightingAction: string | null
  lightingIntensity: number | null
}

export function deriveSimulator(
  prev: SimState | null,
  sim: GqlSimulator
): { events: DerivedEvent[]; state: SimState } {
  const training = !!sim.training
  const rawLevel = sim.alertlevel ?? null
  const effective = training ? '5' : rawLevel
  const action = sim.lighting?.action ?? null
  const intensity = typeof sim.lighting?.intensity === 'number' ? sim.lighting.intensity : null
  const state: SimState = {
    alertLevel: rawLevel,
    training,
    effectiveLevel: effective,
    lightingAction: action,
    lightingIntensity: intensity
  }
  const events: DerivedEvent[] = []
  const initial = prev === null
  if (initial || prev.effectiveLevel !== effective) {
    if (effective != null) {
      events.push({
        name: 'alertLevel.changed',
        simulatorId: sim.id,
        data: {
          level: effective,
          rawLevel,
          training,
          previous: prev?.effectiveLevel ?? null,
          initial,
          simulatorName: sim.name ?? null
        }
      })
    }
  }
  if (!initial && prev.training !== training) {
    events.push({
      name: 'training.changed',
      simulatorId: sim.id,
      data: { training, simulatorName: sim.name ?? null }
    })
  }
  if (!initial && prev.lightingAction !== action && action) {
    events.push({
      name: 'lighting.actionChanged',
      simulatorId: sim.id,
      data: {
        action,
        strength: sim.lighting?.actionStrength ?? null,
        duration: sim.lighting?.transitionDuration ?? null,
        previous: prev.lightingAction
      }
    })
  }
  if (!initial && prev.lightingIntensity !== intensity && intensity != null) {
    events.push({
      name: 'lighting.intensityChanged',
      simulatorId: sim.id,
      data: { intensity, previous: prev.lightingIntensity }
    })
  }
  return { events, state }
}

export interface ReactorState {
  perSystem: Record<
    string,
    {
      battery: number | null
      ejected: boolean
      externalPower: boolean
      heat: number | null
      powerOutput: number | null
    }
  >
}

export function deriveReactors(
  prev: ReactorState | null,
  reactors: GqlReactor[],
  simulatorId: string,
  batteryThresholds: number[],
  heatThreshold: number
): { events: DerivedEvent[]; state: ReactorState } {
  const events: DerivedEvent[] = []
  const state: ReactorState = { perSystem: {} }
  for (const r of reactors) {
    const battery = typeof r.batteryChargeLevel === 'number' ? r.batteryChargeLevel : null
    const ejected = !!r.ejected
    const externalPower = !!r.externalPower
    const heat = typeof r.heat === 'number' ? r.heat : null
    const powerOutput = typeof r.powerOutput === 'number' ? r.powerOutput : null
    state.perSystem[r.id] = { battery, ejected, externalPower, heat, powerOutput }
    const p = prev?.perSystem[r.id]
    if (!p) continue
    const label = {
      systemId: r.id,
      systemName: r.displayName ?? r.name ?? null,
      model: r.model ?? null
    }
    if (battery != null && p.battery != null) {
      for (const t of batteryThresholds) {
        if (p.battery >= t && battery < t)
          events.push({
            name: 'battery.below',
            simulatorId,
            data: { ...label, threshold: t, level: battery }
          })
        if (p.battery < t && battery >= t)
          events.push({
            name: 'battery.above',
            simulatorId,
            data: { ...label, threshold: t, level: battery }
          })
      }
    }
    if (p.ejected !== ejected)
      events.push({
        name: ejected ? 'reactor.ejected' : 'reactor.restored',
        simulatorId,
        data: label
      })
    if (p.externalPower !== externalPower)
      events.push({
        name: externalPower ? 'reactor.externalPowerOn' : 'reactor.externalPowerOff',
        simulatorId,
        data: label
      })
    if (heat != null && p.heat != null) {
      if (p.heat < heatThreshold && heat >= heatThreshold)
        events.push({
          name: 'reactor.heatAbove',
          simulatorId,
          data: { ...label, heat, threshold: heatThreshold }
        })
      if (p.heat >= heatThreshold && heat < heatThreshold)
        events.push({
          name: 'reactor.heatBelow',
          simulatorId,
          data: { ...label, heat, threshold: heatThreshold }
        })
    }
    if (powerOutput != null && p.powerOutput !== powerOutput)
      events.push({
        name: 'power.outputChanged',
        simulatorId,
        data: { ...label, powerOutput, previous: p.powerOutput }
      })
  }
  return { events, state }
}

export interface SystemsState {
  perSystem: Record<string, { damaged: boolean; power: number | null; name: string }>
  totalPower: number
}

export function deriveSystems(
  prev: SystemsState | null,
  systems: GqlSystem[],
  simulatorId: string
): { events: DerivedEvent[]; state: SystemsState } {
  const events: DerivedEvent[] = []
  const state: SystemsState = { perSystem: {}, totalPower: 0 }
  for (const s of systems) {
    const damaged = !!s.damage?.damaged || !!s.damage?.destroyed
    const power = typeof s.power?.power === 'number' ? s.power.power : null
    const name = s.displayName ?? s.name ?? s.id
    state.perSystem[s.id] = { damaged, power, name }
    state.totalPower += power ?? 0
    const p = prev?.perSystem[s.id]
    if (!p) continue
    const label = { systemId: s.id, systemName: name, type: s.type ?? null }
    if (p.damaged !== damaged)
      events.push({
        name: damaged ? 'system.damaged' : 'system.repaired',
        simulatorId,
        data: label
      })
    if (power != null && p.power !== power)
      events.push({
        name: 'system.powerChanged',
        simulatorId,
        data: { ...label, power, previous: p.power }
      })
  }
  if (prev && prev.totalPower !== state.totalPower)
    events.push({
      name: 'power.totalDrawChanged',
      simulatorId,
      data: { total: state.totalPower, previous: prev.totalPower }
    })
  return { events, state }
}

export function deriveShields(
  prevAnyUp: boolean | null,
  shields: GqlShield[],
  simulatorId: string
): { events: DerivedEvent[]; anyUp: boolean } {
  const anyUp = shields.some((s) => !!s.state)
  const events: DerivedEvent[] = []
  if (prevAnyUp != null && prevAnyUp !== anyUp)
    events.push({
      name: anyUp ? 'shields.raised' : 'shields.lowered',
      simulatorId,
      data: { count: shields.filter((s) => s.state).length }
    })
  return { events, anyUp }
}

export function deriveStealth(
  prevOn: boolean | null,
  fields: GqlStealth[],
  simulatorId: string
): { events: DerivedEvent[]; on: boolean } {
  const on = fields.some((s) => !!s.state)
  const events: DerivedEvent[] = []
  if (prevOn != null && prevOn !== on)
    events.push({ name: 'stealth.changed', simulatorId, data: { state: on } })
  return { events, on }
}

export interface FlightState {
  /** flightId → running */
  flights: Record<string, { running: boolean; name: string }>
}

export function deriveFlights(
  prev: FlightState | null,
  flights: GqlFlight[]
): { events: DerivedEvent[]; state: FlightState } {
  const state: FlightState = { flights: {} }
  for (const f of flights) state.flights[f.id] = { running: !!f.running, name: f.name ?? '' }
  const events: DerivedEvent[] = []
  if (prev) {
    for (const [id, cur] of Object.entries(state.flights)) {
      const p = prev.flights[id]
      if (!p) events.push({ name: 'flight.started', data: { flightId: id, name: cur.name } })
      else if (p.running !== cur.running)
        events.push({
          name: cur.running ? 'flight.resumed' : 'flight.paused',
          data: { flightId: id, name: cur.name }
        })
    }
    for (const [id, p] of Object.entries(prev.flights)) {
      if (!state.flights[id])
        events.push({ name: 'flight.ended', data: { flightId: id, name: p.name } })
    }
  }
  return { events, state }
}
