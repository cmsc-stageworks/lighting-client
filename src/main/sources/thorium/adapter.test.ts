import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WebSocketServer, type WebSocket } from 'ws'
import type { AppEvent } from '@shared/types/events'
import { seedThorium } from '@shared/seed'
import { EventBus } from '../../core/eventBus'
import { SimulatorRegistry } from '../../core/simulators'

vi.mock('../../logging', () => ({
  getLogger: () => ({
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined
  })
}))

import { ThoriumAdapter } from './adapter'

/**
 * Fake Thorium: a subscriptions-transport-ws server that answers each `start` with
 * the initial payload for that operation, plus a fetch stub for HTTP queries.
 */
interface Fake {
  wss: WebSocketServer
  port: number
  sockets: WebSocket[]
  started: { id: string; op: string; variables: Record<string, unknown> }[]
  push: (op: string, data: Record<string, unknown>) => void
  httpCalls: string[]
}

const SIM = { id: 'sim-1', name: 'Magellan', alertlevel: '5', training: false }
const FLIGHT = { id: 'f1', name: 'Test Flight', running: true, simulators: [SIM] }

function opName(query: string): string {
  const m = query.match(/\{\s*([a-zA-Z_]+)/)
  return m ? m[1] : ''
}

function initialData(
  op: string,
  variables: Record<string, unknown>
): Record<string, unknown> | null {
  switch (op) {
    case 'flightsUpdate':
      return { flightsUpdate: [FLIGHT] }
    case 'simulatorsUpdate':
      return {
        simulatorsUpdate: [
          {
            ...SIM,
            lighting: {
              intensity: 1,
              action: 'normal',
              actionStrength: 1,
              transitionDuration: 1000
            }
          }
        ]
      }
    case 'reactorUpdate':
      return {
        reactorUpdate: [
          { id: 'batt-1', name: 'Battery', model: 'battery', batteryChargeLevel: 0.6 },
          {
            id: 'reac-1',
            name: 'Reactor',
            model: 'reactor',
            ejected: false,
            externalPower: false,
            heat: 0.1,
            powerOutput: 100
          }
        ]
      }
    case 'systemsUpdate':
      return {
        systemsUpdate: [
          {
            id: 'eng-1',
            name: 'Engines',
            type: 'Engine',
            power: { power: 5 },
            damage: { damaged: false }
          }
        ]
      }
    case 'shieldsUpdate':
      return { shieldsUpdate: [{ id: 'sh-1', state: false }] }
    case 'stealthFieldUpdate':
      return { stealthFieldUpdate: [] }
    case 'clientChanged':
      return {
        clientChanged: [
          { id: variables.clientId, label: 'x', simulator: SIM, flight: FLIGHT, station: null }
        ]
      }
    case 'macrosUpdate':
      return { macrosUpdate: [{ id: 'm1', name: 'Boom' }] }
    case 'macroButtonsUpdate':
      return { macroButtonsUpdate: [] }
    case 'missionsUpdate':
      return { missionsUpdate: [] }
    default:
      return null // events: nothing initially
  }
}

function startFake(): Promise<Fake> {
  return new Promise((resolve) => {
    const sockets: WebSocket[] = []
    const started: Fake['started'] = []
    const wss = new WebSocketServer({ port: 0, handleProtocols: () => 'graphql-ws' })
    wss.on('connection', (ws) => {
      sockets.push(ws)
      ws.on('message', (raw) => {
        const m = JSON.parse(raw.toString()) as {
          type: string
          id?: string
          payload?: { query: string; variables?: Record<string, unknown> }
        }
        if (m.type === 'connection_init') ws.send(JSON.stringify({ type: 'connection_ack' }))
        if (m.type === 'start' && m.payload && m.id) {
          const op = opName(m.payload.query)
          started.push({ id: m.id, op, variables: m.payload.variables ?? {} })
          const data = initialData(op, m.payload.variables ?? {})
          if (data) ws.send(JSON.stringify({ type: 'data', id: m.id, payload: { data } }))
        }
      })
    })
    wss.on('listening', () =>
      resolve({
        wss,
        port: (wss.address() as { port: number }).port,
        sockets,
        started,
        httpCalls: [],
        push: (op, data) => {
          for (const s of started.filter((x) => x.op === op)) {
            for (const sock of sockets)
              sock.send(JSON.stringify({ type: 'data', id: s.id, payload: { data } }))
          }
        }
      })
    )
  })
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const until = async (fn: () => boolean, ms = 3000): Promise<void> => {
  const t = Date.now()
  while (!fn()) {
    if (Date.now() - t > ms) throw new Error('timeout waiting')
    await wait(10)
  }
}

describe('ThoriumAdapter (integration against a fake Thorium)', () => {
  let fake: Fake
  let adapter: ThoriumAdapter
  let bus: EventBus
  let events: AppEvent[]
  const realFetch = globalThis.fetch

  beforeEach(async () => {
    fake = await startFake()
    bus = new EventBus()
    events = []
    bus.on((e) => events.push(e))
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { query: string }
      fake.httpCalls.push(body.query.slice(0, 200))
      let data: Record<string, unknown> = {}
      if (body.query.includes('thorium {')) data = { thorium: { thoriumId: 'thorium-test-id' } }
      else if (body.query.includes('macros {'))
        data = {
          macros: [{ id: 'm1', name: 'Boom' }],
          macroButtons: [],
          missions: [],
          flights: [FLIGHT]
        }
      else if (body.query.includes('clients('))
        data = { clients: [{ id: 'lighting-test', simulator: SIM, flight: FLIGHT, station: null }] }
      return new Response(JSON.stringify({ data }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }) as typeof fetch
    const registry = new SimulatorRegistry()
    registry.setProfiles(
      [
        { id: 'p1', name: 'Magellan', universe: 10, baseAddress: 1, color: '#fff', confirmed: true }
      ],
      'central'
    )
    const settings = {
      ...seedThorium('test'),
      enabled: true,
      host: '127.0.0.1',
      port: fake.port,
      clientId: 'lighting-test'
    }
    adapter = new ThoriumAdapter(settings, bus, registry)
  })

  afterEach(async () => {
    await adapter.stop()
    globalThis.fetch = realFetch
    await new Promise<void>((r) => fake.wss.close(() => r()))
  })

  it('registers, subscribes, scopes simulators and emits the initial alert level', async () => {
    adapter.start()
    await until(() => adapter.runtime().state === 'connected')
    await until(() => fake.httpCalls.some((q) => q.includes('clientConnect')))
    await until(() => events.some((e) => e.name === 'alertLevel.changed'))
    const initial = events.find((e) => e.name === 'alertLevel.changed')!
    expect(initial.data).toMatchObject({ level: '5', initial: true })
    expect(initial.simulatorName).toBe('Magellan')
    expect(adapter.runtime().simulatorsInScope.map((s) => s.name)).toEqual(['Magellan'])
    expect(adapter.runtime().flight?.name).toBe('Test Flight')
    // per-simulator streams were opened for the scoped simulator
    const ops = fake.started.map((s) => s.op)
    for (const op of [
      'events',
      'simulatorsUpdate',
      'reactorUpdate',
      'systemsUpdate',
      'shieldsUpdate'
    ])
      expect(ops).toContain(op)
    expect(events.filter((e) => e.type === 'system' && e.name === 'thorium.connected').length).toBe(
      1
    )
  })

  it('turns firehose and state updates into events with simulator attribution', async () => {
    adapter.start()
    await until(() => fake.started.some((s) => s.op === 'simulatorsUpdate'))
    await wait(50)
    fake.push('events', {
      events: {
        event: 'changeSimulatorAlertLevel',
        simulatorId: 'sim-1',
        alertLevel: '1',
        clientId: 'core'
      }
    })
    fake.push('simulatorsUpdate', {
      simulatorsUpdate: [{ ...SIM, alertlevel: '1', lighting: { intensity: 1, action: 'normal' } }]
    })
    fake.push('reactorUpdate', {
      reactorUpdate: [
        { id: 'batt-1', model: 'battery', batteryChargeLevel: 0.2 },
        {
          id: 'reac-1',
          model: 'reactor',
          ejected: true,
          externalPower: false,
          heat: 0.1,
          powerOutput: 100
        }
      ]
    })
    fake.push('events', {
      events: { event: 'reactorBatteryChargeLevel', id: 'batt-1', level: 0.2 }
    })
    fake.push('events', { events: { event: 'generic', simulatorId: 'other-sim', key: 'ignored' } })
    await until(() => events.some((e) => e.name === 'reactor.ejected'))
    await until(() => events.some((e) => e.name === 'reactorBatteryChargeLevel'))
    const fire = events.find(
      (e) => e.type === 'thorium.event' && e.name === 'changeSimulatorAlertLevel'
    )!
    expect(fire.simulatorName).toBe('Magellan')
    expect(fire.data.alertLevel).toBe('1')
    const derived = events.filter((e) => e.name === 'alertLevel.changed')
    expect(derived[derived.length - 1].data).toMatchObject({
      level: '1',
      previous: '5',
      initial: false
    })
    const below = events.filter((e) => e.name === 'battery.below').map((e) => e.data.threshold)
    expect(below).toEqual(expect.arrayContaining([0.5, 0.25]))
    // system-id-only event resolved to its simulator through the registry
    expect(events.find((e) => e.name === 'reactorBatteryChargeLevel')!.simulatorName).toBe(
      'Magellan'
    )
    // out-of-scope simulator events are dropped
    expect(events.some((e) => e.name === 'generic')).toBe(false)
  })

  it('reports a useful connection test', async () => {
    adapter.start()
    await until(() => adapter.runtime().state === 'connected')
    const report = await adapter.test()
    expect(report.ok).toBe(true)
    expect(report.serverId).toBe('thorium-test-id')
    expect(report.steps.map((s) => s.name)).toEqual([
      'HTTP /graphql reachable',
      'WebSocket subscriptions',
      'Running flights',
      'Client registration',
      'Simulator scope'
    ])
  })
})
