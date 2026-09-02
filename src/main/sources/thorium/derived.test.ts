import { describe, expect, it } from 'vitest'
import {
  deriveFlights,
  deriveReactors,
  deriveShields,
  deriveSimulator,
  deriveSystems
} from './derived'

describe('deriveSimulator', () => {
  it('emits an initial alertLevel.changed and then only on change', () => {
    const a = deriveSimulator(null, { id: 's', name: 'Mag', alertlevel: '5', training: false })
    expect(a.events.map((e) => e.name)).toEqual(['alertLevel.changed'])
    expect(a.events[0].data.initial).toBe(true)
    const b = deriveSimulator(a.state, { id: 's', name: 'Mag', alertlevel: '5', training: false })
    expect(b.events).toEqual([])
    const c = deriveSimulator(b.state, { id: 's', name: 'Mag', alertlevel: '1', training: false })
    expect(c.events[0]).toMatchObject({
      name: 'alertLevel.changed',
      data: { level: '1', previous: '5', initial: false }
    })
  })
  it('training forces level 5 and emits training.changed', () => {
    const a = deriveSimulator(null, { id: 's', alertlevel: '1', training: false })
    const b = deriveSimulator(a.state, { id: 's', alertlevel: '1', training: true })
    expect(b.events.map((e) => e.name).sort()).toEqual(['alertLevel.changed', 'training.changed'])
    expect(b.events.find((e) => e.name === 'alertLevel.changed')!.data.level).toBe('5')
  })
  it('lighting action and intensity changes', () => {
    const a = deriveSimulator(null, {
      id: 's',
      alertlevel: '5',
      lighting: { action: 'normal', intensity: 1 }
    })
    const b = deriveSimulator(a.state, {
      id: 's',
      alertlevel: '5',
      lighting: { action: 'shake', intensity: 0.5, actionStrength: 0.5 }
    })
    expect(b.events.map((e) => e.name).sort()).toEqual([
      'lighting.actionChanged',
      'lighting.intensityChanged'
    ])
  })
})

describe('deriveReactors', () => {
  it('emits battery threshold crossings, ejection and external power', () => {
    const r0 = deriveReactors(
      null,
      [
        { id: 'b1', batteryChargeLevel: 0.6, model: 'battery' },
        { id: 'r1', ejected: false, externalPower: false, heat: 0.2, powerOutput: 100 }
      ],
      's',
      [0.5, 0.25],
      0.9
    )
    expect(r0.events).toEqual([])
    const r1 = deriveReactors(
      r0.state,
      [
        { id: 'b1', batteryChargeLevel: 0.4, model: 'battery' },
        { id: 'r1', ejected: true, externalPower: true, heat: 0.95, powerOutput: 50 }
      ],
      's',
      [0.5, 0.25],
      0.9
    )
    const names = r1.events.map((e) => e.name)
    expect(names).toContain('battery.below')
    expect(r1.events.find((e) => e.name === 'battery.below')!.data.threshold).toBe(0.5)
    expect(names).toContain('reactor.ejected')
    expect(names).toContain('reactor.externalPowerOn')
    expect(names).toContain('reactor.heatAbove')
    expect(names).toContain('power.outputChanged')
    const r2 = deriveReactors(
      r1.state,
      [
        { id: 'b1', batteryChargeLevel: 0.55, model: 'battery' },
        { id: 'r1', ejected: false, externalPower: true, heat: 0.5, powerOutput: 50 }
      ],
      's',
      [0.5, 0.25],
      0.9
    )
    expect(r2.events.map((e) => e.name).sort()).toEqual([
      'battery.above',
      'reactor.heatBelow',
      'reactor.restored'
    ])
  })
})

describe('deriveSystems / shields / flights', () => {
  it('system damage and total power', () => {
    const s0 = deriveSystems(
      null,
      [{ id: 'a', name: 'Engines', power: { power: 5 }, damage: { damaged: false } }],
      's'
    )
    const s1 = deriveSystems(
      s0.state,
      [{ id: 'a', name: 'Engines', power: { power: 2 }, damage: { damaged: true } }],
      's'
    )
    expect(s1.events.map((e) => e.name).sort()).toEqual([
      'power.totalDrawChanged',
      'system.damaged',
      'system.powerChanged'
    ])
    const s2 = deriveSystems(
      s1.state,
      [{ id: 'a', name: 'Engines', power: { power: 2 }, damage: { damaged: false } }],
      's'
    )
    expect(s2.events.map((e) => e.name)).toEqual(['system.repaired'])
  })
  it('shields raised / lowered', () => {
    const a = deriveShields(null, [{ id: '1', state: false }], 's')
    expect(a.events).toEqual([])
    const b = deriveShields(a.anyUp, [{ id: '1', state: true }], 's')
    expect(b.events[0].name).toBe('shields.raised')
    const c = deriveShields(b.anyUp, [{ id: '1', state: false }], 's')
    expect(c.events[0].name).toBe('shields.lowered')
  })
  it('flight lifecycle across several concurrent flights', () => {
    const a = deriveFlights(null, [])
    const b = deriveFlights(a.state, [
      { id: 'f1', name: 'Room 1', running: true },
      { id: 'f2', name: 'Room 2', running: true }
    ])
    expect(b.events.map((e) => e.name)).toEqual(['flight.started', 'flight.started'])
    const c = deriveFlights(b.state, [
      { id: 'f1', name: 'Room 1', running: false },
      { id: 'f2', name: 'Room 2', running: true }
    ])
    expect(c.events).toEqual([{ name: 'flight.paused', data: { flightId: 'f1', name: 'Room 1' } }])
    const d = deriveFlights(c.state, [
      { id: 'f2', name: 'Room 2', running: true },
      { id: 'f3', name: 'Clean slate', running: true }
    ])
    expect(d.events.map((e) => `${e.name}:${e.data.flightId}`).sort()).toEqual([
      'flight.ended:f1',
      'flight.started:f3'
    ])
  })
})
