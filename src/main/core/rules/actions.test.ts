import { describe, expect, it, vi } from 'vitest'

vi.mock('../../logging', () => ({
  getLogger: () => ({
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined
  })
}))

import type { Action, Mapping, Profile, SimulatorProfile } from '@shared/types/config'
import type { AppEvent } from '@shared/types/events'
import { LAYER_IDS } from '@shared/constants'
import { seedLayers } from '@shared/seed'
import { Compositor } from '../compositor/compositor'
import type { EventBus } from '../eventBus'
import type { SimulatorRegistry } from '../simulators'
import { ActionRunner } from './actions'

const magellan: SimulatorProfile = {
  id: 'p-mag',
  name: 'Magellan',
  universe: 10,
  baseAddress: 100,
  color: '#fff',
  confirmed: true
}
const cassini: SimulatorProfile = {
  id: 'p-cas',
  name: 'Cassini',
  universe: 10,
  baseAddress: 200,
  color: '#fff',
  confirmed: true
}

const setLevel = (over: Partial<Extract<Action, { kind: 'setLevel' }>> = {}): Action => ({
  kind: 'setLevel',
  target: 'event',
  addressing: 'relative',
  channels: [0],
  source: {
    path: 'intensity',
    inMin: 0,
    inMax: 1,
    outMin: 0,
    outMax: 255,
    curve: 'linear',
    invert: false
  },
  fade: { kind: 'fromEvent', path: 'transitionDuration', fallbackMs: 0 },
  layerId: null,
  label: 'House',
  ...over
})

const holdLevel = (over: Partial<Extract<Action, { kind: 'holdLevel' }>> = {}): Action => ({
  kind: 'holdLevel',
  target: 'event',
  addressing: 'relative',
  channels: [0],
  value: 200,
  hold: { kind: 'fromEvent', path: 'duration', units: 'ms', fallbackMs: 1000 },
  fallback: null,
  fade: { kind: 'none' },
  layerId: null,
  label: 'Flash',
  ...over
})

function intensityEvent(over: Partial<AppEvent> = {}): AppEvent {
  return {
    id: 'e',
    ts: 0,
    source: 'thorium',
    type: 'thorium.state',
    name: 'lighting.intensityChanged',
    simulatorId: 't-mag',
    simulatorName: 'Magellan',
    data: { intensity: 1, transitionDuration: null, initial: false },
    matchedMappingIds: [],
    ...over
  }
}

const mapping: Mapping = {
  id: 'm1',
  name: 'Follow intensity',
  enabled: true,
  category: 'General',
  triggers: [],
  simulatorNames: [],
  actions: [],
  debounceMs: 0,
  notes: ''
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function setup(profiles: SimulatorProfile[] = [magellan]) {
  let now = 1000
  const compositor = new Compositor(() => now)
  compositor.setLayers(seedLayers())
  compositor.setCarriedUniverses([10])
  const warnings: string[] = []
  const thoriumSims = [
    { id: 't-mag', name: 'Magellan', profileId: 'p-mag' },
    { id: 't-cas', name: 'Cassini', profileId: 'p-cas' }
  ]
  const registry = {
    profileByName: (n?: string) => profiles.find((p) => p.name === n) ?? null,
    profileById: (id: string) => profiles.find((p) => p.id === id) ?? null,
    allProfiles: () => profiles,
    defaultProfile: () => profiles[0] ?? null,
    inScope: () => thoriumSims,
    thoriumSimulatorByName: (n: string) => thoriumSims.find((s) => s.name === n),
    thoriumSimulatorById: (id: string) => thoriumSims.find((s) => s.id === id)
  } as unknown as SimulatorRegistry
  const runner = new ActionRunner({
    compositor,
    registry,
    bus: { emit: () => undefined } as unknown as EventBus,
    profile: () =>
      ({ scenes: [], layers: seedLayers(), outputs: [{ universe: 7 }] }) as unknown as Profile,
    mqttPublish: () => undefined,
    thorium: {
      triggerMacro: async () => true,
      setAlertLevel: async () => undefined,
      notify: async () => undefined
    },
    warn: (w) => warnings.push(w)
  })
  return {
    runner,
    compositor,
    warnings,
    advance: (ms: number) => {
      now += ms
      compositor.tick()
    }
  }
}

describe('ActionRunner setLevel', () => {
  it('writes the scaled value at baseAddress + offset', async () => {
    const t = setup()
    await t.runner.runOne(setLevel({ channels: [0, 5] }), intensityEvent(), mapping)
    const f = t.compositor.frame(10)
    expect(f.values[100]).toBe(255)
    expect(f.values[105]).toBe(255)
  })

  it('follows the value on repeat events without stacking instances', async () => {
    const t = setup()
    const a = setLevel()
    await t.runner.runOne(a, intensityEvent(), mapping)
    await t.runner.runOne(a, intensityEvent({ data: { intensity: 0.25 } }), mapping)
    await t.runner.runOne(a, intensityEvent({ data: { intensity: 0.5 } }), mapping)
    expect(t.compositor.getInstances()).toHaveLength(1)
    expect(t.compositor.frame(10).values[100]).toBe(128)
  })

  it("runs Thorium's fade itself, because Thorium only sends the destination", async () => {
    const t = setup()
    const a = setLevel()
    await t.runner.runOne(a, intensityEvent({ data: { intensity: 0 } }), mapping)
    await t.runner.runOne(
      a,
      intensityEvent({ data: { intensity: 1, transitionDuration: 4000 } }),
      mapping
    )
    expect(t.compositor.frame(10).values[100]).toBe(0)
    t.advance(2000)
    expect(t.compositor.frame(10).values[100]).toBe(128)
    t.advance(2000)
    expect(t.compositor.frame(10).values[100]).toBe(255)
  })

  it('keeps a separate level per simulator when targeting all', async () => {
    const t = setup([magellan, cassini])
    const a = setLevel({ target: 'all' })
    await t.runner.runOne(a, intensityEvent({ data: { intensity: 1 } }), mapping)
    await t.runner.runOne(
      a,
      intensityEvent({ simulatorName: 'Cassini', data: { intensity: 0.2 } }),
      mapping
    )
    // "all" drove both; the second call moved both, so they share a value —
    // what matters is that each ship writes to its own block.
    const f = t.compositor.frame(10)
    expect(f.values[100]).toBe(51)
    expect(f.values[200]).toBe(51)
    expect(t.compositor.getInstances()).toHaveLength(2)
  })

  it('event-targeted levels stay independent per simulator', async () => {
    const t = setup([magellan, cassini])
    const a = setLevel()
    await t.runner.runOne(a, intensityEvent({ data: { intensity: 1 } }), mapping)
    await t.runner.runOne(
      a,
      intensityEvent({
        simulatorId: 't-cas',
        simulatorName: 'Cassini',
        data: { intensity: 0.2 }
      }),
      mapping
    )
    const f = t.compositor.frame(10)
    expect(f.values[100]).toBe(255)
    expect(f.values[200]).toBe(51)
  })

  it('absolute addressing ignores the simulator', async () => {
    const t = setup()
    await t.runner.runOne(
      setLevel({ addressing: 'absolute', universe: 12, channels: [3] }),
      intensityEvent(),
      mapping
    )
    expect(t.compositor.frame(12).values[3]).toBe(255)
  })

  it('warns instead of writing when the path holds no number', async () => {
    const t = setup()
    await t.runner.runOne(setLevel(), intensityEvent({ data: { intensity: null } }), mapping)
    expect(t.warnings[0]).toMatch(/no number at "intensity"/)
    expect(t.compositor.getInstances()).toHaveLength(0)
  })

  it('warns when a relative level has no simulator profile', async () => {
    const t = setup([])
    await t.runner.runOne(setLevel(), intensityEvent(), mapping)
    expect(t.warnings.join(' ')).toMatch(/Simulators page/)
  })

  it('lands on the layer the action names', async () => {
    const t = setup()
    await t.runner.runOne(setLevel({ layerId: LAYER_IDS.effect }), intensityEvent(), mapping)
    expect(t.compositor.getInstances()[0].layerId).toBe(LAYER_IDS.effect)
  })
})

describe('ActionRunner holdLevel', () => {
  const damage = (data: Record<string, unknown>): AppEvent =>
    intensityEvent({ name: 'system.damaged', data })

  it('holds the value the action sets for the duration the event carries', async () => {
    const t = setup()
    await t.runner.runOne(holdLevel(), damage({ duration: 3000 }), mapping)
    expect(t.compositor.frame(10).values[100]).toBe(200)
    t.advance(2999)
    expect(t.compositor.frame(10).values[100]).toBe(200)
    t.advance(2)
    expect(t.compositor.frame(10).values[100]).toBe(0)
  })

  it('reads the duration in seconds when the action says so', async () => {
    const t = setup()
    await t.runner.runOne(
      holdLevel({ hold: { kind: 'fromEvent', path: 'duration', units: 'seconds', fallbackMs: 0 } }),
      damage({ duration: 2 }),
      mapping
    )
    t.advance(1900)
    expect(t.compositor.frame(10).values[100]).toBe(200)
    t.advance(200)
    expect(t.compositor.frame(10).values[100]).toBe(0)
  })

  it('warns but still holds for the fallback when the path carries no number', async () => {
    const t = setup()
    await t.runner.runOne(holdLevel(), damage({}), mapping)
    expect(t.warnings[0]).toMatch(/no duration at "duration"/)
    expect(t.compositor.frame(10).values[100]).toBe(200)
    t.advance(1001)
    expect(t.compositor.frame(10).values[100]).toBe(0)
  })

  it('a latch hold stays up until something releases it', async () => {
    const t = setup()
    await t.runner.runOne(holdLevel({ hold: { kind: 'latch' } }), damage({ duration: 10 }), mapping)
    t.advance(60_000)
    expect(t.compositor.frame(10).values[100]).toBe(200)
    t.compositor.releaseAll()
    t.advance(1)
    expect(t.compositor.frame(10).values[100]).toBe(0)
  })

  it('re-firing keeps one instance and extends the hold', async () => {
    const t = setup()
    const a = holdLevel()
    await t.runner.runOne(a, damage({ duration: 2000 }), mapping)
    t.advance(1500)
    await t.runner.runOne(a, damage({ duration: 2000 }), mapping)
    expect(t.compositor.getInstances()).toHaveLength(1)
    t.advance(1500)
    expect(t.compositor.frame(10).values[100]).toBe(200)
    t.advance(600)
    expect(t.compositor.frame(10).values[100]).toBe(0)
  })

  it('writes at baseAddress + offset, and absolutely when told to', async () => {
    const t = setup()
    await t.runner.runOne(holdLevel({ channels: [0, 5] }), damage({ duration: 5000 }), mapping)
    const f = t.compositor.frame(10)
    expect(f.values[100]).toBe(200)
    expect(f.values[105]).toBe(200)
    await t.runner.runOne(
      holdLevel({ addressing: 'absolute', universe: 12, channels: [3], value: 77 }),
      damage({ duration: 5000 }),
      mapping
    )
    expect(t.compositor.frame(12).values[3]).toBe(77)
  })

  it('does not fight with a setLevel on the same channels', async () => {
    const t = setup()
    await t.runner.runOne(setLevel(), intensityEvent(), mapping)
    await t.runner.runOne(holdLevel(), damage({ duration: 1000 }), mapping)
    expect(t.compositor.getInstances()).toHaveLength(2)
    // The hold went on last, so it wins its layer until it expires.
    expect(t.compositor.frame(10).values[100]).toBe(200)
    t.advance(1100)
    expect(t.compositor.frame(10).values[100]).toBe(255)
  })
})

describe('ActionRunner holdLevel fallback stage', () => {
  const damage = (data: Record<string, unknown>): AppEvent =>
    intensityEvent({ name: 'system.damaged', data })

  it('runs value → fallback → release off one event', async () => {
    const t = setup()
    await t.runner.runOne(
      holdLevel({ fallback: { value: 64, hold: { kind: 'fixed', ms: 2000 } } }),
      damage({ duration: 1000 }),
      mapping
    )
    expect(t.compositor.frame(10).values[100]).toBe(200)
    t.advance(1100)
    expect(t.compositor.frame(10).values[100]).toBe(64)
    t.advance(1900)
    expect(t.compositor.frame(10).values[100]).toBe(64)
    t.advance(200)
    expect(t.compositor.frame(10).values[100]).toBe(0)
  })

  it('takes the fallback hold off the event too', async () => {
    const t = setup()
    await t.runner.runOne(
      holdLevel({
        hold: { kind: 'fixed', ms: 500 },
        fallback: {
          value: 100,
          hold: { kind: 'fromEvent', path: 'cooldown', units: 'seconds', fallbackMs: 0 }
        }
      }),
      damage({ cooldown: 3 }),
      mapping
    )
    t.advance(600)
    expect(t.compositor.frame(10).values[100]).toBe(100)
    t.advance(2900)
    expect(t.compositor.frame(10).values[100]).toBe(100)
    t.advance(200)
    expect(t.compositor.frame(10).values[100]).toBe(0)
  })

  it('a latched fallback waits for a release', async () => {
    const t = setup()
    await t.runner.runOne(
      holdLevel({ fallback: { value: 20, hold: { kind: 'latch' } } }),
      damage({ duration: 500 }),
      mapping
    )
    t.advance(600)
    expect(t.compositor.frame(10).values[100]).toBe(20)
    t.advance(600_000)
    expect(t.compositor.frame(10).values[100]).toBe(20)
    t.compositor.releaseAll()
    t.advance(1)
    expect(t.compositor.frame(10).values[100]).toBe(0)
  })

  it('follows each simulator through both stages when targeting all', async () => {
    const t = setup([magellan, cassini])
    await t.runner.runOne(
      holdLevel({
        target: 'all',
        fallback: { value: 40, hold: { kind: 'fixed', ms: 1000 } }
      }),
      damage({ duration: 500 }),
      mapping
    )
    expect(t.compositor.getInstances()).toHaveLength(2)
    t.advance(600)
    const f = t.compositor.frame(10)
    expect(f.values[100]).toBe(40)
    expect(f.values[200]).toBe(40)
  })

  it('warns once per stage when a duration path is wrong', async () => {
    const t = setup()
    await t.runner.runOne(
      holdLevel({
        fallback: {
          value: 10,
          hold: { kind: 'fromEvent', path: 'cooldown', units: 'ms', fallbackMs: 500 }
        }
      }),
      damage({}),
      mapping
    )
    expect(t.warnings).toHaveLength(2)
    expect(t.warnings[0]).toMatch(/no duration at "duration"/)
    expect(t.warnings[1]).toMatch(/no duration at "cooldown"/)
  })
})
