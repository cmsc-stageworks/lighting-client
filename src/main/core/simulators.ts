import type { SimulatorProfile, ThoriumScope } from '@shared/types/config'
import type { SimulatorInScope } from '@shared/types/state'
import { eqIgnoreCase } from '@shared/utils'

export interface ThoriumSimulator {
  id: string
  name: string
  alertLevel: string | null
  training: boolean
  flightId: string
}

export interface ThoriumFlight {
  id: string
  name: string
  running: boolean
  /** ISO date from Thorium; newer flights win name conflicts */
  date: string | null
  simulators: ThoriumSimulator[]
}

export interface Assignment {
  flightId: string | null
  flightName: string | null
  simulatorId: string | null
  simulatorName: string | null
  station: string | null
}

const NO_ASSIGNMENT: Assignment = {
  flightId: null,
  flightName: null,
  simulatorId: null,
  simulatorName: null,
  station: null
}

/**
 * Knows about (a) the simulator profiles from config, (b) every running flight and its
 * simulators as reported by Thorium, (c) this client's Flight Director assignment, and
 * (d) which ship system ids belong to which simulator. From those it answers the one
 * question everything else asks: "is this simulator / flight in scope right now?"
 *
 * Thorium can run several flights at once (one per control room, or a training flight
 * next to its clean-slate replacement). Simulator names repeat across flights, so
 * assignment-based scoping is authoritative; name-based scoping falls back to the
 * newest flight when a name is ambiguous.
 */
export class SimulatorRegistry {
  private profiles: SimulatorProfile[] = []
  private flights: ThoriumFlight[] = []
  private scope: ThoriumScope = { mode: 'all' }
  private assignment: Assignment = NO_ASSIGNMENT
  private systemToSim = new Map<string, string>()
  private profileKind: 'central' | 'single-ship' = 'central'

  setProfiles(profiles: SimulatorProfile[], kind: 'central' | 'single-ship'): void {
    this.profiles = profiles
    this.profileKind = kind
  }
  setScope(scope: ThoriumScope): void {
    this.scope = scope
  }
  setAssignment(a: Partial<Assignment> | null): void {
    this.assignment = { ...NO_ASSIGNMENT, ...(a ?? {}) }
  }
  getAssignment(): Assignment {
    return this.assignment
  }
  setFlights(flights: ThoriumFlight[]): void {
    this.flights = flights
  }
  getFlights(): ThoriumFlight[] {
    return this.flights
  }
  updateThoriumSimulator(sim: Partial<ThoriumSimulator> & { id: string }): void {
    for (const f of this.flights) {
      const existing = f.simulators.find((s) => s.id === sim.id)
      if (existing) {
        Object.assign(existing, sim)
        return
      }
    }
  }
  registerSystem(systemId: string, simulatorId: string): void {
    this.systemToSim.set(systemId, simulatorId)
  }
  simulatorIdForSystem(systemId: string): string | undefined {
    return this.systemToSim.get(systemId)
  }
  clearSystems(): void {
    this.systemToSim.clear()
  }

  // ------------------------------------------------------------------ lookups

  allThoriumSimulators(): ThoriumSimulator[] {
    return this.flights.flatMap((f) => f.simulators)
  }
  thoriumSimulatorById(id: string): ThoriumSimulator | undefined {
    return this.allThoriumSimulators().find((s) => s.id === id)
  }
  /** Prefers a simulator in scope, then the newest flight, when names repeat across flights. */
  thoriumSimulatorByName(name: string): ThoriumSimulator | undefined {
    const inScope = this.inScope().find((s) => eqIgnoreCase(s.name, name))
    if (inScope) return this.thoriumSimulatorById(inScope.id)
    for (const f of this.flightsNewestFirst()) {
      const s = f.simulators.find((x) => eqIgnoreCase(x.name, name))
      if (s) return s
    }
    return undefined
  }
  flightById(id: string | null | undefined): ThoriumFlight | undefined {
    if (!id) return undefined
    return this.flights.find((f) => f.id === id)
  }

  profileByName(name: string | null | undefined): SimulatorProfile | undefined {
    if (!name) return undefined
    return this.profiles.find((p) => eqIgnoreCase(p.name, name))
  }
  profileById(id: string): SimulatorProfile | undefined {
    return this.profiles.find((p) => p.id === id)
  }
  allProfiles(): SimulatorProfile[] {
    return this.profiles
  }

  /** In a single-ship profile the only profile is "the" simulator for UI actions. */
  defaultProfile(): SimulatorProfile | undefined {
    if (this.profileKind === 'single-ship') return this.profiles[0]
    const inScope = this.inScope()
    if (inScope.length === 1 && inScope[0].profileId) return this.profileById(inScope[0].profileId)
    return undefined
  }

  // ------------------------------------------------------------------ scope

  /** Scope modes that do nothing until the Flight Director assigns this client. */
  requiresAssignment(): boolean {
    return this.scope.mode === 'follow-assignment' || this.scope.mode === 'assigned-flight'
  }
  isAssigned(): boolean {
    return !!this.assignment.flightId && !!this.flightById(this.assignment.flightId)
  }

  /** Running flights first, then newest: name-based scoping should prefer a live flight. */
  private flightsNewestFirst(): ThoriumFlight[] {
    return [...this.flights].sort(
      (a, b) => Number(b.running) - Number(a.running) || (b.date ?? '').localeCompare(a.date ?? '')
    )
  }

  /** Flights whose events are in scope. Empty = nothing is in scope. */
  scopeFlights(): ThoriumFlight[] {
    const assigned = this.flightById(this.assignment.flightId)
    switch (this.scope.mode) {
      case 'follow-assignment':
      case 'assigned-flight':
        return assigned ? [assigned] : []
      default:
        // Name-based modes: when assigned, respect that; otherwise consider every running flight.
        return assigned ? [assigned] : this.flightsNewestFirst()
    }
  }

  isFlightInScope(flightId: string | undefined): boolean {
    if (!flightId) return !this.requiresAssignment() || this.isAssigned()
    return this.scopeFlights().some((f) => f.id === flightId)
  }

  /** Thorium simulators currently in scope for this instance. */
  inScope(): SimulatorInScope[] {
    const flights = this.scopeFlights()
    let sims: ThoriumSimulator[] = []
    switch (this.scope.mode) {
      case 'follow-assignment': {
        // The FD's simulator when set; until then, every simulator of the assigned flight.
        const all = flights.flatMap((f) => f.simulators)
        const picked = all.filter((s) => s.id === this.assignment.simulatorId)
        sims = picked.length ? picked : all
        break
      }
      case 'assigned-flight':
        sims = flights.flatMap((f) => f.simulators)
        break
      case 'pinned': {
        const wanted = this.scope.simulatorNames
        const taken = new Set<string>()
        for (const f of flights) {
          for (const s of f.simulators) {
            const key = s.name.toLowerCase()
            if (!wanted.some((n) => eqIgnoreCase(n, s.name)) || taken.has(key)) continue
            taken.add(key)
            sims.push(s)
          }
        }
        break
      }
      default: {
        // 'all': every simulator; a repeated name only counts once (newest flight wins).
        const taken = new Set<string>()
        for (const f of flights) {
          for (const s of f.simulators) {
            const key = s.name.toLowerCase()
            if (taken.has(key)) continue
            taken.add(key)
            sims.push(s)
          }
        }
      }
    }
    return sims.map((s) => ({
      id: s.id,
      name: s.name,
      alertLevel: s.alertLevel,
      training: s.training,
      flightId: s.flightId,
      flightName: this.flightById(s.flightId)?.name ?? null,
      profileId: this.profileByName(s.name)?.id ?? null
    }))
  }

  isInScope(simulatorId: string | undefined): boolean {
    if (!simulatorId) return true // events without a simulator are filtered by flight instead
    return this.inScope().some((s) => s.id === simulatorId)
  }

  /** Human-readable scope problems for the UI. */
  warnings(): string[] {
    const out: string[] = []
    if (this.requiresAssignment() && !this.isAssigned()) {
      out.push('Not assigned to a flight by the Flight Director — no mappings will run.')
    }
    if (this.scope.mode === 'pinned') {
      for (const n of this.scope.simulatorNames) {
        if (!this.allThoriumSimulators().some((s) => eqIgnoreCase(s.name, n)))
          out.push(`Pinned simulator "${n}" is not in any running flight.`)
      }
    }
    if (
      !this.assignment.flightId &&
      this.flights.length > 1 &&
      this.scope.mode !== 'follow-assignment' &&
      this.scope.mode !== 'assigned-flight'
    ) {
      const names = new Map<string, number>()
      for (const s of this.allThoriumSimulators())
        names.set(s.name.toLowerCase(), (names.get(s.name.toLowerCase()) ?? 0) + 1)
      const dups = [...names.entries()].filter(([, n]) => n > 1).map(([k]) => k)
      if (dups.length)
        out.push(
          `${this.flights.length} flights are running and share simulator names (${dups.join(', ')}); the newest flight is used. Assign this client to a flight to make it explicit.`
        )
    }
    return out
  }

  /** Unmatched pinned names, for UI warnings. */
  unmatchedPinnedNames(): string[] {
    if (this.scope.mode !== 'pinned') return []
    return this.scope.simulatorNames.filter(
      (n) => !this.allThoriumSimulators().some((s) => eqIgnoreCase(s.name, n))
    )
  }
}
