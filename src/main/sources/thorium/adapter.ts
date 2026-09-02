import { EventEmitter } from 'events'
import type { ThoriumSettings } from '@shared/types/config'
import type {
  ReferenceData,
  ThoriumProbeResult,
  ThoriumRuntime,
  ThoriumTestReport
} from '@shared/types/state'
import { THORIUM_EVENT_NAMES } from '@shared/thoriumEventNames'
import type { EventBus } from '../../core/eventBus'
import type { SimulatorRegistry } from '../../core/simulators'
import { getLogger } from '../../logging'
import {
  deriveFlights,
  deriveReactors,
  deriveShields,
  deriveSimulator,
  deriveStealth,
  deriveSystems,
  type FlightState,
  type ReactorState,
  type SimState,
  type SystemsState
} from './derived'
import { ThoriumHttp } from './http'
import {
  M_CLIENT_CONNECT,
  M_CLIENT_DISCONNECT,
  M_NOTIFY,
  M_SET_ALERT,
  M_TRIGGER_MACRO,
  Q_CLIENT,
  Q_PROBE,
  Q_REFDATA,
  Q_VERSION,
  SUB_CLIENT,
  SUB_EVENTS,
  SUB_FLIGHTS,
  SUB_MACROS,
  SUB_MACRO_BUTTONS,
  SUB_MISSIONS,
  SUB_REACTOR,
  SUB_SHIELDS,
  SUB_SIMULATOR,
  SUB_STEALTH,
  SUB_SYSTEMS,
  type GqlClient,
  type GqlFlight,
  type GqlReactor,
  type GqlRefData,
  type GqlShield,
  type GqlSimulator,
  type GqlStealth,
  type GqlSystem
} from './operations'
import { SubscriptionsClient } from './protocol'

const log = getLogger('thorium')

interface PerSimSubs {
  unsubs: (() => void)[]
  sim: SimState | null
  reactors: ReactorState | null
  systems: SystemsState | null
  shieldsUp: boolean | null
  stealthOn: boolean | null
}

/**
 * Owns the Thorium connection: registration, scope, the events firehose, state
 * subscriptions with derived events, and reference data for the trigger editor.
 */
export class ThoriumAdapter extends EventEmitter {
  private settings: ThoriumSettings
  private ws: SubscriptionsClient
  private http: ThoriumHttp
  private state: ThoriumRuntime = {
    state: 'disabled',
    flights: [],
    simulatorsInScope: [],
    assignment: null,
    waitingForAssignment: false,
    scopeWarnings: [],
    eventsPerSec: 0,
    reconnects: 0,
    since: null
  }
  private globalUnsubs: (() => void)[] = []
  private perSim = new Map<string, PerSimSubs>()
  private flightState: FlightState | null = null
  private refData: ReferenceData = {
    fetchedAt: null,
    macros: [],
    macroButtonConfigs: [],
    missions: [],
    simulators: [],
    seenEventNames: [],
    knownEventNames: THORIUM_EVENT_NAMES
  }
  private rttTimer: ReturnType<typeof setInterval> | null = null
  private eventTimes: number[] = []
  private droppedOutOfScope = 0
  private started = false

  constructor(
    settings: ThoriumSettings,
    private bus: EventBus,
    private registry: SimulatorRegistry
  ) {
    super()
    this.settings = settings
    this.ws = new SubscriptionsClient(
      () =>
        `${this.settings.secure ? 'wss' : 'ws'}://${this.settings.host}:${this.settings.port}/graphql`,
      () => ({ clientId: this.settings.clientId })
    )
    this.http = new ThoriumHttp(
      () => this.baseUrl(),
      () => this.settings.clientId
    )
    this.ws.on('connected', () => void this.onConnected())
    this.ws.on('disconnected', (reason: string) => this.onDisconnected(reason))
    this.ws.on('error', (err: Error) => {
      if (this.state.state !== 'connected')
        this.setState({ state: 'reconnecting', reason: err.message })
    })
  }

  baseUrl(): string {
    return `${this.settings.secure ? 'https' : 'http'}://${this.settings.host}:${this.settings.port}`
  }

  runtime(): ThoriumRuntime {
    const now = Date.now()
    while (this.eventTimes.length && this.eventTimes[0] < now - 5000) this.eventTimes.shift()
    const a = this.registry.getAssignment()
    return {
      ...this.state,
      flights: this.registry.getFlights().map((f) => ({
        id: f.id,
        name: f.name,
        running: f.running,
        simulators: f.simulators.map((x) => x.name)
      })),
      simulatorsInScope: this.registry.inScope(),
      assignment:
        a.flightId || a.simulatorId
          ? {
              flightId: a.flightId,
              flight: a.flightName,
              simulatorId: a.simulatorId,
              simulator: a.simulatorName,
              station: a.station
            }
          : null,
      waitingForAssignment:
        this.settings.enabled && this.registry.requiresAssignment() && !this.registry.isAssigned(),
      scopeWarnings: this.registry.warnings(),
      eventsPerSec: Math.round((this.eventTimes.length / 5) * 10) / 10,
      reconnects: this.ws.reconnects
    }
  }

  referenceData(): ReferenceData {
    return this.refData
  }

  private setState(patch: Partial<ThoriumRuntime>): void {
    this.state = { ...this.state, ...patch }
    this.emit('state', this.runtime())
  }

  // ------------------------------------------------------------------ lifecycle

  start(): void {
    if (!this.settings.enabled) {
      this.setState({ state: 'disabled', reason: undefined })
      return
    }
    this.started = true
    this.setState({ state: 'connecting', reason: undefined })
    this.ws.connect()
  }

  async stop(): Promise<void> {
    this.started = false
    if (this.rttTimer) clearInterval(this.rttTimer)
    this.rttTimer = null
    this.teardownSubscriptions()
    if (this.ws.isConnected()) {
      await this.http
        .mutate(M_CLIENT_DISCONNECT, { client: this.settings.clientId })
        .catch(() => undefined)
    }
    this.ws.close()
    this.setState({ state: 'disabled', since: null })
  }

  /** Apply new settings; reconnects only when connection parameters changed. */
  async updateSettings(next: ThoriumSettings): Promise<void> {
    const prev = this.settings
    this.settings = next
    this.registry.setScope(next.scope)
    const connChanged =
      prev.host !== next.host ||
      prev.port !== next.port ||
      prev.secure !== next.secure ||
      prev.clientId !== next.clientId ||
      prev.enabled !== next.enabled
    if (connChanged) {
      await this.stop()
      this.start()
      return
    }
    if (prev.clientLabel !== next.clientLabel && this.ws.isConnected()) {
      await this.http
        .mutate(M_CLIENT_CONNECT, { client: next.clientId, label: next.clientLabel })
        .catch(() => undefined)
    }
    this.resyncScope()
  }

  reconnect(): void {
    if (!this.settings.enabled) return
    this.setState({ state: 'connecting' })
    this.ws.reconnectNow()
  }

  private async onConnected(): Promise<void> {
    log.info(`connected to ${this.baseUrl()}`)
    this.setState({ state: 'connected', reason: undefined, since: Date.now() })
    try {
      await this.http.mutate(M_CLIENT_CONNECT, {
        client: this.settings.clientId,
        label: this.settings.clientLabel
      })
    } catch (err) {
      log.warn(`clientConnect failed: ${(err as Error).message}`)
    }
    await this.refreshReferenceData().catch((err) =>
      log.warn(`refdata failed: ${(err as Error).message}`)
    )
    await this.fetchAssignment().catch(() => undefined)
    this.setupGlobalSubscriptions()
    this.resyncScope()
    this.bus.emit({
      source: 'system',
      type: 'system',
      name: 'thorium.connected',
      data: { url: this.baseUrl() }
    })
    if (this.rttTimer) clearInterval(this.rttTimer)
    this.rttTimer = setInterval(() => void this.measureRtt(), 15000)
    void this.measureRtt()
  }

  private onDisconnected(reason: string): void {
    log.warn(`disconnected: ${reason}`)
    this.teardownSubscriptions()
    this.setState({ state: this.started ? 'reconnecting' : 'disabled', reason, since: null })
    this.bus.emit({
      source: 'system',
      type: 'system',
      name: 'thorium.disconnected',
      data: { reason }
    })
  }

  private async measureRtt(): Promise<void> {
    const t = Date.now()
    try {
      const d = await this.http.query<{ thorium?: { thoriumId?: string } }>(Q_VERSION)
      this.setState({
        rttMs: Date.now() - t,
        serverId: d?.thorium?.thoriumId ?? this.state.serverId
      })
    } catch {
      this.setState({ rttMs: null })
    }
  }

  // ------------------------------------------------------------------ subscriptions

  private setupGlobalSubscriptions(): void {
    this.globalUnsubs.push(
      this.ws.subscribe(SUB_EVENTS, undefined, (data) => this.onFirehose(data?.events)),
      this.ws.subscribe(SUB_FLIGHTS, undefined, (data) =>
        this.onFlights((data?.flightsUpdate as GqlFlight[] | null) ?? [])
      ),
      this.ws.subscribe(SUB_CLIENT, { clientId: this.settings.clientId }, (data) =>
        this.onClientChanged((data?.clientChanged as GqlClient[] | null) ?? [])
      ),
      this.ws.subscribe(SUB_MACROS, undefined, (data) => {
        const macros = (data?.macrosUpdate as { id: string; name?: string | null }[] | null) ?? []
        this.refData = {
          ...this.refData,
          macros: macros.map((m) => ({ id: m.id, name: m.name ?? m.id })),
          fetchedAt: Date.now()
        }
        this.emit('refdata', this.refData)
      }),
      this.ws.subscribe(SUB_MACRO_BUTTONS, undefined, (data) => {
        const cfgs = (data?.macroButtonsUpdate as GqlRefData['macroButtons']) ?? []
        this.refData = {
          ...this.refData,
          macroButtonConfigs: mapButtons(cfgs),
          fetchedAt: Date.now()
        }
        this.emit('refdata', this.refData)
      }),
      this.ws.subscribe(SUB_MISSIONS, undefined, (data) => {
        const missions = (data?.missionsUpdate as GqlRefData['missions']) ?? []
        this.refData = { ...this.refData, missions: mapMissions(missions), fetchedAt: Date.now() }
        this.emit('refdata', this.refData)
      })
    )
  }

  private teardownSubscriptions(): void {
    for (const u of this.globalUnsubs) u()
    this.globalUnsubs = []
    for (const [, s] of this.perSim) for (const u of s.unsubs) u()
    this.perSim.clear()
    this.registry.clearSystems()
  }

  /** (Re)subscribe per-simulator streams to match the current scope. */
  private resyncScope(): void {
    if (!this.ws.isConnected()) return
    const wanted = new Set(this.registry.inScope().map((s) => s.id))
    for (const [id, s] of this.perSim) {
      if (!wanted.has(id)) {
        for (const u of s.unsubs) u()
        this.perSim.delete(id)
        this.emit('scopeLeft', id)
      }
    }
    for (const id of wanted) {
      if (this.perSim.has(id)) continue
      const entry: PerSimSubs = {
        unsubs: [],
        sim: null,
        reactors: null,
        systems: null,
        shieldsUp: null,
        stealthOn: null
      }
      this.perSim.set(id, entry)
      entry.unsubs.push(
        this.ws.subscribe(SUB_SIMULATOR, { simulatorId: id }, (data) =>
          this.onSimulator(id, (data?.simulatorsUpdate as GqlSimulator[] | null) ?? [])
        ),
        this.ws.subscribe(SUB_REACTOR, { simulatorId: id }, (data) =>
          this.onReactors(id, (data?.reactorUpdate as GqlReactor[] | null) ?? [])
        ),
        this.ws.subscribe(SUB_SYSTEMS, { simulatorId: id }, (data) =>
          this.onSystems(id, (data?.systemsUpdate as GqlSystem[] | null) ?? [])
        ),
        this.ws.subscribe(SUB_SHIELDS, { simulatorId: id }, (data) =>
          this.onShields(id, (data?.shieldsUpdate as GqlShield[] | null) ?? [])
        ),
        this.ws.subscribe(SUB_STEALTH, { simulatorId: id }, (data) =>
          this.onStealth(id, (data?.stealthFieldUpdate as GqlStealth[] | null) ?? [])
        )
      )
    }
    this.emit('state', this.runtime())
  }

  // ------------------------------------------------------------------ handlers

  private onFirehose(payload: unknown): void {
    if (!payload || typeof payload !== 'object') return
    const p = payload as Record<string, unknown>
    const event = typeof p.event === 'string' ? p.event : null
    if (!event) return
    this.eventTimes.push(Date.now())
    let simulatorId = typeof p.simulatorId === 'string' ? p.simulatorId : undefined
    if (!simulatorId && typeof p.id === 'string')
      simulatorId = this.registry.simulatorIdForSystem(p.id)
    if (simulatorId && !this.registry.isInScope(simulatorId)) {
      this.droppedOutOfScope++
      return
    }
    const flightId = typeof p.flightId === 'string' ? p.flightId : undefined
    if (!simulatorId && !this.registry.isFlightInScope(flightId)) {
      this.droppedOutOfScope++
      return
    }
    // `flight.reset` derived from the resetFlight mutation on the firehose.
    if (event === 'resetFlight') {
      this.bus.emit({
        source: 'thorium',
        type: 'thorium.state',
        name: 'flight.reset',
        data: { flightId: p.flightId ?? null }
      })
    }
    const simName = simulatorId ? this.registry.thoriumSimulatorById(simulatorId)?.name : undefined
    this.bus.emit({
      source: 'thorium',
      type: 'thorium.event',
      name: event,
      simulatorId,
      simulatorName: simName,
      data: { ...p, event }
    })
  }

  private onFlights(flights: GqlFlight[]): void {
    const { events, state } = deriveFlights(this.flightState, flights)
    this.flightState = state
    this.registry.setFlights(
      flights.map((f) => ({
        id: f.id,
        name: f.name ?? '',
        running: !!f.running,
        date: f.date ?? null,
        simulators: (f.simulators ?? []).map((s) => ({
          id: s.id,
          name: s.name ?? s.id,
          alertLevel: s.alertlevel ?? null,
          training: !!s.training,
          flightId: f.id
        }))
      }))
    )
    const seen = new Set<string>()
    const simulators: { id: string; name: string }[] = []
    for (const s of this.registry.allThoriumSimulators()) {
      if (seen.has(s.id)) continue
      seen.add(s.id)
      simulators.push({ id: s.id, name: s.name })
    }
    this.refData = { ...this.refData, simulators }
    const assigned = this.registry.flightById(this.registry.getAssignment().flightId)
    this.setState({
      flight: assigned ? { id: assigned.id, name: assigned.name, running: assigned.running } : null
    })
    for (const e of events) {
      // Flight-level events only matter for flights in scope (the assigned one, when assigned).
      if (!this.registry.isFlightInScope(String(e.data.flightId ?? ''))) continue
      this.bus.emit({ source: 'thorium', type: 'thorium.state', name: e.name, data: e.data })
    }
    this.resyncScope()
    this.emit('refdata', this.refData)
  }

  private onClientChanged(clients: GqlClient[]): void {
    const me = clients.find((c) => c.id === this.settings.clientId)
    if (!me) return
    this.applyAssignment(me)
  }

  private async fetchAssignment(): Promise<void> {
    const d = await this.http.query<{ clients?: GqlClient[] | null }>(Q_CLIENT, {
      clientId: this.settings.clientId
    })
    const me = d?.clients?.find((c) => c.id === this.settings.clientId)
    if (me) this.applyAssignment(me)
  }

  private applyAssignment(me: GqlClient): void {
    const prev = this.registry.getAssignment()
    const next = {
      flightId: me.flight?.id ?? null,
      flightName: me.flight?.name ?? null,
      simulatorId: me.simulator?.id ?? null,
      simulatorName: me.simulator?.name ?? null,
      station: me.station?.name ?? null
    }
    const changed = JSON.stringify(next) !== JSON.stringify(prev)
    if (!changed) return
    this.registry.setAssignment(next)
    const assignedFlight = this.registry.flightById(next.flightId)
    this.setState({
      flight: assignedFlight
        ? { id: assignedFlight.id, name: assignedFlight.name, running: assignedFlight.running }
        : null
    })
    const lostFlight = !!prev.flightId && prev.flightId !== next.flightId
    if (lostFlight) {
      log.info(
        `assignment changed: flight ${prev.flightName ?? prev.flightId} → ${next.flightName ?? next.flightId ?? 'none'}`
      )
      this.emit('assignmentLost', {
        previousFlight: prev.flightName,
        previousSimulator: prev.simulatorName
      })
    }
    this.bus.emit({
      source: 'thorium',
      type: 'thorium.state',
      name: 'client.assigned',
      simulatorId: next.simulatorId ?? undefined,
      simulatorName: next.simulatorName ?? undefined,
      data: {
        flight: next.flightName,
        flightId: next.flightId,
        simulator: next.simulatorName,
        station: next.station,
        previousFlight: prev.flightName
      }
    })
    this.resyncScope()
  }

  private onSimulator(simId: string, sims: GqlSimulator[]): void {
    const entry = this.perSim.get(simId)
    const sim = sims.find((s) => s.id === simId)
    if (!entry || !sim) return
    this.registry.updateThoriumSimulator({
      id: sim.id,
      name: sim.name ?? undefined,
      alertLevel: sim.training ? '5' : (sim.alertlevel ?? null),
      training: !!sim.training
    })
    const { events, state } = deriveSimulator(entry.sim, sim)
    entry.sim = state
    for (const e of events)
      this.bus.emit({
        source: 'thorium',
        type: 'thorium.state',
        name: e.name,
        simulatorId: simId,
        simulatorName: sim.name ?? undefined,
        data: e.data
      })
    if (events.length) this.emit('state', this.runtime())
  }

  private onReactors(simId: string, reactors: GqlReactor[]): void {
    const entry = this.perSim.get(simId)
    if (!entry) return
    for (const r of reactors) this.registry.registerSystem(r.id, simId)
    const { events, state } = deriveReactors(
      entry.reactors,
      reactors,
      simId,
      this.settings.batteryThresholds,
      this.settings.reactorHeatThreshold
    )
    entry.reactors = state
    this.emitDerived(simId, events)
  }

  private onSystems(simId: string, systems: GqlSystem[]): void {
    const entry = this.perSim.get(simId)
    if (!entry) return
    for (const s of systems) this.registry.registerSystem(s.id, simId)
    const { events, state } = deriveSystems(entry.systems, systems, simId)
    entry.systems = state
    this.emitDerived(simId, events)
  }

  private onShields(simId: string, shields: GqlShield[]): void {
    const entry = this.perSim.get(simId)
    if (!entry) return
    for (const s of shields) this.registry.registerSystem(s.id, simId)
    const { events, anyUp } = deriveShields(entry.shieldsUp, shields, simId)
    entry.shieldsUp = anyUp
    this.emitDerived(simId, events)
  }

  private onStealth(simId: string, fields: GqlStealth[]): void {
    const entry = this.perSim.get(simId)
    if (!entry) return
    for (const s of fields) this.registry.registerSystem(s.id, simId)
    const { events, on } = deriveStealth(entry.stealthOn, fields, simId)
    entry.stealthOn = on
    this.emitDerived(simId, events)
  }

  private emitDerived(
    simId: string,
    events: { name: string; data: Record<string, unknown> }[]
  ): void {
    const simName = this.registry.thoriumSimulatorById(simId)?.name
    for (const e of events)
      this.bus.emit({
        source: 'thorium',
        type: 'thorium.state',
        name: e.name,
        simulatorId: simId,
        simulatorName: simName,
        data: e.data
      })
  }

  // ------------------------------------------------------------------ reference data

  async refreshReferenceData(): Promise<ReferenceData> {
    const d = await this.http.query<GqlRefData>(Q_REFDATA)
    if (d) {
      this.refData = {
        ...this.refData,
        fetchedAt: Date.now(),
        macros: (d.macros ?? []).map((m) => ({ id: m.id, name: m.name ?? m.id })),
        macroButtonConfigs: mapButtons(d.macroButtons ?? []),
        missions: mapMissions(d.missions ?? [])
      }
      if (d.flights) this.onFlights(d.flights)
      this.emit('refdata', this.refData)
    }
    return this.refData
  }

  setSeenEventNames(names: string[]): void {
    this.refData = { ...this.refData, seenEventNames: names }
  }

  // ------------------------------------------------------------------ mutations

  async triggerMacro(simulatorId: string, macroName: string): Promise<boolean> {
    const macro = this.refData.macros.find((m) => m.name.toLowerCase() === macroName.toLowerCase())
    if (!macro) {
      log.warn(`macro "${macroName}" not found`)
      return false
    }
    await this.http.mutate(M_TRIGGER_MACRO, { simulatorId, macroId: macro.id })
    return true
  }

  async setAlertLevel(simulatorId: string, level: string): Promise<void> {
    await this.http.mutate(M_SET_ALERT, { simulatorId, alertLevel: level })
  }

  async notify(simulatorId: string, title: string, body: string, color: string): Promise<void> {
    await this.http.mutate(M_NOTIFY, { simulatorId, title, body, color })
  }

  // ------------------------------------------------------------------ test

  async test(): Promise<ThoriumTestReport> {
    const started = Date.now()
    const steps: ThoriumTestReport['steps'] = []
    const report: ThoriumTestReport = { ok: false, steps, durationMs: 0 }
    try {
      const t = Date.now()
      const d = await this.http.query<{ thorium?: { thoriumId?: string } }>(Q_VERSION)
      report.rttMs = Date.now() - t
      report.serverId = d?.thorium?.thoriumId ?? undefined
      steps.push({
        name: 'HTTP /graphql reachable',
        ok: true,
        detail: `${this.baseUrl()} answered in ${report.rttMs} ms${report.serverId ? ` · server ${report.serverId}` : ''}`
      })
    } catch (err) {
      steps.push({ name: 'HTTP /graphql reachable', ok: false, detail: (err as Error).message })
      report.durationMs = Date.now() - started
      return report
    }
    steps.push({
      name: 'WebSocket subscriptions',
      ok: this.ws.isConnected(),
      detail: this.ws.isConnected()
        ? 'connected and acknowledged'
        : this.settings.enabled
          ? `state: ${this.state.state}${this.state.reason ? ' – ' + this.state.reason : ''}`
          : 'Thorium source is disabled'
    })
    try {
      const d = await this.http.query<GqlRefData>(Q_REFDATA)
      const flights = d?.flights ?? []
      const flight = flights[0] ?? null
      report.flight = flight ? { id: flight.id, name: flight.name ?? '' } : null
      report.simulators = flights.flatMap((f) =>
        (f.simulators ?? []).map((x) => ({
          id: x.id,
          name: `${x.name ?? x.id} (${f.name ?? f.id})`,
          alertLevel: x.alertlevel ?? null
        }))
      )
      steps.push({
        name: 'Running flights',
        ok: flights.length > 0,
        detail: flights.length
          ? flights
              .map(
                (f) =>
                  `${f.name ?? f.id}: ${(f.simulators ?? []).map((x) => x.name).join(', ') || 'no simulators'}`
              )
              .join(' · ')
          : 'No flight is running'
      })
    } catch (err) {
      steps.push({ name: 'Running flight', ok: false, detail: (err as Error).message })
    }
    try {
      const d = await this.http.query<{ clients?: GqlClient[] | null }>(Q_CLIENT, {
        clientId: this.settings.clientId
      })
      const me = d?.clients?.find((c) => c.id === this.settings.clientId)
      report.assignment = me
        ? {
            flightId: me.flight?.id ?? null,
            flight: me.flight?.name ?? null,
            simulatorId: me.simulator?.id ?? null,
            simulator: me.simulator?.name ?? null,
            station: me.station?.name ?? null
          }
        : null
      steps.push({
        name: 'Client registration',
        ok: !!me,
        detail: me
          ? `Registered as "${me.label ?? this.settings.clientId}"${me.simulator?.name ? ', assigned to ' + me.simulator.name : ', not assigned to a simulator'}`
          : 'This client is not registered (connect first)'
      })
    } catch (err) {
      steps.push({ name: 'Client registration', ok: false, detail: (err as Error).message })
    }
    const inScope = this.registry.inScope()
    const warnings = this.registry.warnings()
    steps.push({
      name: 'Simulator scope',
      ok: inScope.length > 0 || !this.ws.isConnected(),
      detail: inScope.length
        ? inScope
            .map((s) => `${s.name}${s.flightName ? ' (' + s.flightName + ')' : ''}`)
            .join(', ') + (warnings.length ? ' — ' + warnings.join(' ') : '')
        : warnings.join(' ') || 'No simulators in scope yet'
    })
    report.ok = steps.every((s) => s.ok)
    report.durationMs = Date.now() - started
    return report
  }
}

function mapButtons(
  cfgs: NonNullable<GqlRefData['macroButtons']>
): ReferenceData['macroButtonConfigs'] {
  return cfgs.map((c) => ({
    id: c.id,
    name: c.name ?? c.id,
    buttons: (c.buttons ?? []).map((b) => ({
      id: b.id,
      name: b.name ?? b.id,
      category: b.category ?? null
    }))
  }))
}

function mapMissions(missions: NonNullable<GqlRefData['missions']>): ReferenceData['missions'] {
  return missions.map((m) => ({
    id: m.id,
    name: m.name ?? m.id,
    timeline: (m.timeline ?? []).map((t) => ({
      id: t.id,
      name: t.name ?? t.id,
      items: (t.timelineItems ?? []).map((i) => ({
        id: i.id,
        name: i.name ?? i.id,
        event: i.event ?? ''
      }))
    }))
  }))
}

/**
 * One-off read of a Thorium server's running flights, without touching the live adapter.
 * Used by setup so the user can discover simulators before saving any connection settings.
 */
export async function probeThorium(
  host: string,
  port: number,
  secure: boolean
): Promise<ThoriumProbeResult> {
  const base = `${secure ? 'https' : 'http'}://${host}:${port}`
  const http = new ThoriumHttp(
    () => base,
    () => 'lighting-probe',
    5000
  )
  try {
    const d = await http.query<{ thorium?: { thoriumId?: string }; flights?: GqlFlight[] | null }>(
      Q_PROBE
    )
    return {
      ok: true,
      serverId: d?.thorium?.thoriumId ?? undefined,
      flights: (d?.flights ?? []).map((f) => ({
        id: f.id,
        name: f.name ?? f.id,
        running: !!f.running,
        simulators: (f.simulators ?? []).map((s) => ({
          id: s.id,
          name: s.name ?? s.id,
          alertLevel: s.alertlevel ?? null
        }))
      }))
    }
  } catch (err) {
    return { ok: false, error: (err as Error).message, flights: [] }
  }
}
