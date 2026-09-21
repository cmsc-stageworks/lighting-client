import { beforeEach, describe, expect, it } from 'vitest'
import type { Layer, Scene, SimulatorProfile } from '@shared/types/config'
import { LAYER_IDS } from '@shared/constants'
import { seedLayers } from '@shared/seed'
import { Compositor } from './compositor'

const layers: Layer[] = seedLayers()
const sim: SimulatorProfile = {
  id: 'simA',
  name: 'Magellan',
  universe: 10,
  baseAddress: 1,
  color: '#fff',
  confirmed: true
}
const simB: SimulatorProfile = {
  id: 'simB',
  name: 'Cassini',
  universe: 10,
  baseAddress: 51,
  color: '#fff',
  confirmed: true
}

function scene(over: Partial<Scene>): Scene {
  return {
    id: over.id ?? 's',
    name: over.name ?? 'Scene',
    category: 'x',
    color: '#fff',
    addressing: 'relative',
    defaultUniverse: 10,
    entries: [{ channel: 0, value: 255 }],
    behavior: { kind: 'latch' },
    fadeInMs: 0,
    fadeOutMs: 0,
    defaultLayerId: LAYER_IDS.alert,
    showOnDashboard: true,
    reducedEffectsCleared: false,
    notes: '',
    ...over
  }
}

describe('Compositor', () => {
  let now = 1000
  let c: Compositor
  beforeEach(() => {
    now = 1000
    c = new Compositor(() => now)
    c.setLayers(layers)
    c.setCarriedUniverses([10])
  })

  it('renders zeros when nothing is active', () => {
    const f = c.frame(10)
    expect(f.values[1]).toBe(0)
    expect(f.owners[1]).toBeNull()
  })

  it('relative addressing resolves to base + offset', () => {
    c.activate(scene({ entries: [{ channel: 2, value: 200 }] }), simB, null)
    const f = c.frame(10)
    expect(f.values[53]).toBe(200)
    expect(f.values[3]).toBe(0)
  })

  it('absolute scenes ignore the simulator', () => {
    c.activate(
      scene({ addressing: 'absolute', entries: [{ channel: 100, value: 10, universe: 12 }] }),
      null,
      null
    )
    expect(c.universes()).toContain(12)
    expect(c.frame(12).values[100]).toBe(10)
  })

  it('higher layer wins per channel, lower shows through when released', () => {
    c.activate(
      scene({
        id: 'alert',
        entries: [
          { channel: 0, value: 100 },
          { channel: 1, value: 100 }
        ]
      }),
      sim,
      null
    )
    c.activate(
      scene({ id: 'fx', defaultLayerId: LAYER_IDS.effect, entries: [{ channel: 0, value: 255 }] }),
      sim,
      null
    )
    let f = c.frame(10)
    expect(f.values[1]).toBe(255)
    expect(f.values[2]).toBe(100)
    c.releaseScene('fx', 'simA')
    c.tick()
    f = c.frame(10)
    expect(f.values[1]).toBe(100)
  })

  it('LTP within a layer: latest activation wins', () => {
    c.activate(scene({ id: 'a', entries: [{ channel: 0, value: 50 }] }), sim, null)
    now += 10
    c.activate(scene({ id: 'b', entries: [{ channel: 0, value: 150 }] }), sim, null)
    expect(c.frame(10).values[1]).toBe(150)
  })

  it('same scene re-activated replaces its instance (no stacking)', () => {
    c.activate(scene({ id: 'a', entries: [{ channel: 0, value: 50 }] }), sim, null)
    c.activate(scene({ id: 'a', entries: [{ channel: 0, value: 50 }] }), sim, null)
    expect(c.getInstances().length).toBe(1)
  })

  it('same scene for two simulators coexists', () => {
    const s = scene({ id: 'a', entries: [{ channel: 0, value: 50 }] })
    c.activate(s, sim, null)
    c.activate(s, simB, null)
    const f = c.frame(10)
    expect(f.values[1]).toBe(50)
    expect(f.values[51]).toBe(50)
    expect(c.getInstances().length).toBe(2)
  })

  it('timed scenes release after hold and fade out', () => {
    c.activate(
      scene({
        id: 't',
        behavior: { kind: 'timed', holdMs: 1000 },
        fadeOutMs: 1000,
        defaultLayerId: LAYER_IDS.effect
      }),
      sim,
      null
    )
    expect(c.frame(10).values[1]).toBe(255)
    now += 1500
    c.tick()
    expect(c.getInstances()[0].releaseStartedAt).not.toBeNull()
    now += 500
    c.tick()
    expect(c.frame(10).values[1]).toBeCloseTo(128, -1)
    now += 600
    c.tick()
    expect(c.getInstances().length).toBe(0)
    expect(c.frame(10).values[1]).toBe(0)
  })

  it('fade in crossfades from the layer below', () => {
    c.activate(scene({ id: 'base', entries: [{ channel: 0, value: 100 }] }), sim, null)
    c.activate(
      scene({
        id: 'fx',
        defaultLayerId: LAYER_IDS.effect,
        fadeInMs: 1000,
        entries: [{ channel: 0, value: 200 }]
      }),
      sim,
      null
    )
    expect(c.frame(10).values[1]).toBe(100)
    now += 500
    c.tick()
    expect(c.frame(10).values[1]).toBe(150)
  })

  it('blackout zeroes everything and grand master scales', () => {
    c.activate(scene({ entries: [{ channel: 0, value: 200 }] }), sim, null)
    c.setGrandMaster(0.5)
    expect(c.frame(10).values[1]).toBe(100)
    c.setBlackout(true)
    expect(c.frame(10).values[1]).toBe(0)
    c.setBlackout(false)
    c.setGrandMaster(1)
    expect(c.frame(10).values[1]).toBe(200)
  })

  it('test channel sits above scenes and clears', () => {
    c.activate(scene({ entries: [{ channel: 0, value: 200 }] }), sim, null)
    c.setTestChannel(10, 1, 7)
    expect(c.frame(10).values[1]).toBe(7)
    expect(c.frame(10).owners[1]).toBe('test')
    c.clearTest()
    expect(c.frame(10).values[1]).toBe(200)
  })

  it('releaseLayer and releaseAll respect the test layer', () => {
    c.activate(scene({ id: 'a' }), sim, null)
    c.activate(scene({ id: 'b', defaultLayerId: LAYER_IDS.effect }), sim, null)
    c.setTestChannel(10, 5, 5)
    expect(c.releaseLayer(LAYER_IDS.effect)).toBe(1)
    expect(c.releaseAll()).toBe(1)
    c.tick()
    expect(c.getInstances().length).toBe(1)
    expect(c.getInstances()[0].instanceId).toBe('test')
  })

  it('drops out-of-range relative channels with a warning', () => {
    const { warnings } = c.activate(
      scene({
        entries: [
          { channel: 511, value: 1 },
          { channel: 600, value: 1 }
        ]
      }),
      sim,
      null
    )
    expect(warnings.length).toBe(1)
    expect(c.frame(10).values[512]).toBe(1)
  })

  it('relative scene without a simulator does nothing but warns', () => {
    const { instance, warnings } = c.activate(scene({}), null, null)
    expect(instance).toBeNull()
    expect(warnings[0]).toMatch(/relative/)
  })

  describe('setLevel', () => {
    const spec = {
      layerId: LAYER_IDS.scene,
      universe: 10,
      channels: [5],
      value: 200,
      fadeMs: 0,
      label: 'House'
    }

    it('holds a channel at the value and updates in place', () => {
      c.setLevel('k', spec)
      expect(c.frame(10).values[5]).toBe(200)
      c.setLevel('k', { ...spec, value: 40 })
      expect(c.getInstances().length).toBe(1)
      expect(c.frame(10).values[5]).toBe(40)
      expect(c.activeSummaries()[0].level).toBe(40)
    })

    it('keys instances separately so two simulators do not fight', () => {
      c.setLevel('a', spec)
      c.setLevel('b', { ...spec, channels: [6], value: 10 })
      expect(c.getInstances().length).toBe(2)
      const f = c.frame(10)
      expect(f.values[5]).toBe(200)
      expect(f.values[6]).toBe(10)
    })

    it('fades the value rather than the instance, so the layer below never shows', () => {
      // A scene underneath at full on the same channel.
      c.activate(
        scene({
          id: 'base',
          defaultLayerId: LAYER_IDS.base,
          entries: [{ channel: 4, value: 255 }]
        }),
        sim,
        null
      )
      c.setLevel('k', { ...spec, channels: [5], value: 100, fadeMs: 0 })
      c.setLevel('k', { ...spec, channels: [5], value: 200, fadeMs: 1000 })
      now += 500
      c.tick()
      // Half way from 100 to 200 — not a dip toward the layer below.
      expect(c.frame(10).values[5]).toBe(150)
      now += 500
      c.tick()
      expect(c.frame(10).values[5]).toBe(200)
    })

    it('a change mid-fade continues from where the output actually is', () => {
      c.setLevel('k', { ...spec, value: 0, fadeMs: 0 })
      c.setLevel('k', { ...spec, value: 100, fadeMs: 1000 })
      now += 500
      c.tick()
      expect(c.frame(10).values[5]).toBe(50)
      c.setLevel('k', { ...spec, value: 0, fadeMs: 1000 })
      now += 500
      c.tick()
      // From 50 → 0, half done.
      expect(c.frame(10).values[5]).toBe(25)
    })

    it('ramps a brand new level up from zero', () => {
      c.setLevel('k', { ...spec, value: 200, fadeMs: 1000 })
      expect(c.frame(10).values[5]).toBe(0)
      now += 500
      c.tick()
      expect(c.frame(10).values[5]).toBe(100)
    })

    it('marks the universe dirty while a value fade runs', () => {
      c.setLevel('k', { ...spec, value: 255, fadeMs: 1000 })
      c.frame(10)
      expect(c.isDirty(10)).toBe(false)
      now += 100
      c.tick()
      expect(c.isDirty(10)).toBe(true)
    })

    it('releases with the rest and comes back when driven again', () => {
      c.setLevel('k', spec)
      c.releaseAll()
      c.tick()
      expect(c.frame(10).values[5]).toBe(0)
      c.setLevel('k', { ...spec, value: 90 })
      expect(c.frame(10).values[5]).toBe(90)
    })

    it('warns on an out-of-range channel and drops it', () => {
      const { warnings } = c.setLevel('k', { ...spec, channels: [5, 600] })
      expect(warnings.length).toBe(1)
      expect(c.frame(10).values[5]).toBe(200)
    })

    it('reports itself as a level in the summaries', () => {
      c.setLevel('k', spec)
      const [s] = c.activeSummaries()
      expect(s.kind).toBe('level')
      expect(s.level).toBe(200)
      expect(s.sceneName).toBe('House')
    })
  })
})
