import { describe, expect, it } from 'vitest'
import type { AppEvent } from '../types/events'
import type { ReferenceData } from '../types/state'
import { compileTrigger, listPresets, summarizeTrigger } from './catalog'
import { compile, compileMapping, matchMapping, matchTrigger } from './matcher'

const ev = (partial: Partial<AppEvent>): AppEvent => ({
  id: 'e',
  ts: 0,
  source: 'thorium',
  type: 'thorium.event',
  name: 'x',
  data: {},
  matchedMappingIds: [],
  ...partial
})

const refData: ReferenceData = {
  fetchedAt: 1,
  macros: [{ id: 'm1', name: 'Red Alert Lights' }],
  macroButtonConfigs: [
    { id: 'c1', name: 'Main', buttons: [{ id: 'b1', name: 'Hyperspace', category: null }] }
  ],
  missions: [
    {
      id: 'mi1',
      name: 'Rescue',
      timeline: [
        { id: 's1', name: 'Arrival', items: [{ id: 'i1', name: 'Dim lights', event: 'generic' }] }
      ]
    }
  ],
  simulators: [],
  seenEventNames: [],
  knownEventNames: []
}

describe('trigger catalog', () => {
  it('every preset compiles with its defaults', () => {
    for (const p of listPresets()) {
      const c = compileTrigger(p.key, p.defaults, { refData })
      // Presets whose defaults need user input (e.g. an empty key) must say so, never match silently.
      expect(
        c.types.length > 0 || (typeof c.unresolved === 'string' && c.unresolved.length > 0),
        p.key
      ).toBe(true)
      expect(typeof summarizeTrigger(p.key, p.defaults)).toBe('string')
    }
  })
  it('rejects invalid params', () => {
    const c = compileTrigger('thorium.alertLevel', { levels: [] }, { refData })
    expect(c.unresolved).toBeTruthy()
  })
  it('unknown preset is unresolved', () => {
    expect(compileTrigger('nope', {}, { refData }).unresolved).toBeTruthy()
  })

  it('alert level matches derived event with loose level equality', () => {
    const t = compile(
      {
        preset: 'thorium.alertLevel',
        params: { levels: ['1', 'p'] },
        conditions: []
      },
      { refData }
    )
    expect(
      matchTrigger(
        t,
        ev({ type: 'thorium.state', name: 'alertLevel.changed', data: { level: '1' } })
      )
    ).toBe(true)
    expect(
      matchTrigger(
        t,
        ev({ type: 'thorium.state', name: 'alertLevel.changed', data: { level: 'p' } })
      )
    ).toBe(true)
    expect(
      matchTrigger(
        t,
        ev({ type: 'thorium.state', name: 'alertLevel.changed', data: { level: '3' } })
      )
    ).toBe(false)
    expect(
      matchTrigger(
        t,
        ev({ type: 'thorium.event', name: 'alertLevel.changed', data: { level: '1' } })
      )
    ).toBe(false)
  })
  it('includeInitial=false ignores the connect-time event', () => {
    const t = compile(
      {
        preset: 'thorium.alertLevel',
        params: { levels: ['1'], includeInitial: false },
        conditions: []
      },
      { refData }
    )
    expect(
      matchTrigger(
        t,
        ev({
          type: 'thorium.state',
          name: 'alertLevel.changed',
          data: { level: '1', initial: true }
        })
      )
    ).toBe(false)
    expect(
      matchTrigger(
        t,
        ev({
          type: 'thorium.state',
          name: 'alertLevel.changed',
          data: { level: '1', initial: false }
        })
      )
    ).toBe(true)
  })
  it('shake preset distinguishes short and long by duration', () => {
    const short = ev({
      name: 'lightingShakeLights',
      data: { event: 'lightingShakeLights', simulatorId: 's', duration: 5000 }
    })
    const long = ev({
      name: 'lightingShakeLights',
      data: { event: 'lightingShakeLights', simulatorId: 's', duration: 15000 }
    })
    const macroShake = ev({
      name: 'lightingSetEffect',
      data: { event: 'lightingSetEffect', effect: 'shake', duration: 3000 }
    })
    const macroWork = ev({
      name: 'lightingSetEffect',
      data: { event: 'lightingSetEffect', effect: 'work' }
    })
    const cfg = (params: Record<string, unknown>): ReturnType<typeof compile> =>
      compile({ preset: 'thorium.shake', params, conditions: [] }, { refData })

    const any = cfg({ length: 'any' })
    expect(matchTrigger(any, short)).toBe(true)
    expect(matchTrigger(any, long)).toBe(true)
    expect(matchTrigger(any, macroShake)).toBe(true)
    expect(matchTrigger(any, macroWork)).toBe(false)

    const shortT = cfg({ length: 'short' })
    expect(matchTrigger(shortT, short)).toBe(true)
    expect(matchTrigger(shortT, long)).toBe(false)

    const longT = cfg({ length: 'long' })
    expect(matchTrigger(longT, long)).toBe(true)
    expect(matchTrigger(longT, short)).toBe(false)

    const exactT = cfg({ length: 'exact', exactMs: 15000 })
    expect(matchTrigger(exactT, long)).toBe(true)
    expect(matchTrigger(exactT, short)).toBe(false)
  })
  it('generic key supports globs', () => {
    const t = compile(
      {
        preset: 'thorium.generic',
        params: { key: 'lights-*' },
        conditions: []
      },
      { refData }
    )
    expect(matchTrigger(t, ev({ name: 'generic', data: { key: 'lights-hyperspace' } }))).toBe(true)
    expect(matchTrigger(t, ev({ name: 'generic', data: { key: 'sound-1' } }))).toBe(false)
  })
  it('macro by name resolves through reference data', () => {
    const t = compile(
      {
        preset: 'thorium.macro',
        params: { macroName: 'red alert lights' },
        conditions: []
      },
      { refData }
    )
    expect(t.unresolved).toBeUndefined()
    expect(matchTrigger(t, ev({ name: 'triggerMacroAction', data: { macroId: 'm1' } }))).toBe(true)
    const missing = compile(
      {
        preset: 'thorium.macro',
        params: { macroName: 'nope' },
        conditions: []
      },
      { refData }
    )
    expect(missing.unresolved).toMatch(/not found/)
  })
  it('macro button and timeline item resolve ids', () => {
    const b = compile(
      {
        preset: 'thorium.macroButton',
        params: { buttonName: 'Hyperspace' },
        conditions: []
      },
      { refData }
    )
    expect(
      matchTrigger(b, ev({ name: 'triggerMacroButton', data: { buttonId: 'b1', configId: 'c1' } }))
    ).toBe(true)
    const tl = compile(
      {
        preset: 'thorium.timelineItem',
        params: { missionName: 'Rescue', stepName: 'Arrival' },
        conditions: []
      },
      { refData }
    )
    expect(
      matchTrigger(
        tl,
        ev({ name: 'triggerMacros', data: { macros: [{ stepId: 'i1', event: 'generic' }] } })
      )
    ).toBe(true)
    expect(
      matchTrigger(tl, ev({ name: 'triggerMacros', data: { macros: [{ stepId: 'zz' }] } }))
    ).toBe(false)
  })
  it('simulator restriction is case-insensitive', () => {
    const m = compileMapping(
      {
        triggers: [
          { preset: 'custom.event', params: { eventName: 'shieldRaised' }, conditions: [] }
        ],
        simulatorNames: ['magellan', 'Phoenix']
      },
      { refData }
    )
    expect(matchMapping(m, ev({ name: 'shieldRaised', simulatorName: 'Magellan' }))).toBe(true)
    expect(matchMapping(m, ev({ name: 'shieldRaised', simulatorName: 'Cassini' }))).toBe(false)
    expect(matchMapping(m, ev({ name: 'shieldRaised', simulatorName: 'phoenix' }))).toBe(true)
    expect(matchMapping(m, ev({ name: 'shieldRaised' }))).toBe(false)
  })
  it('a mapping fires when any of its triggers matches', () => {
    const m = compileMapping(
      {
        triggers: [
          { preset: 'custom.event', params: { eventName: 'shieldRaised' }, conditions: [] },
          { preset: 'thorium.generic', params: { key: 'lights-*' }, conditions: [] }
        ],
        simulatorNames: []
      },
      { refData }
    )
    expect(m.unresolved).toBeUndefined()
    expect(m.partial).toBeUndefined()
    expect(matchMapping(m, ev({ name: 'shieldRaised' }))).toBe(true)
    expect(matchMapping(m, ev({ name: 'generic', data: { key: 'lights-hyperspace' } }))).toBe(true)
    expect(matchMapping(m, ev({ name: 'somethingElse' }))).toBe(false)
  })
  it('one unresolved trigger is partial; all unresolved is fatal', () => {
    const partial = compileMapping(
      {
        triggers: [
          { preset: 'custom.event', params: { eventName: 'shieldRaised' }, conditions: [] },
          { preset: 'thorium.macro', params: { macroName: 'nope' }, conditions: [] }
        ],
        simulatorNames: []
      },
      { refData }
    )
    expect(partial.unresolved).toBeUndefined()
    expect(partial.partial).toMatch(/trigger 2/)
    // The resolved alternative still fires.
    expect(matchMapping(partial, ev({ name: 'shieldRaised' }))).toBe(true)

    const fatal = compileMapping(
      {
        triggers: [{ preset: 'thorium.macro', params: { macroName: 'nope' }, conditions: [] }],
        simulatorNames: []
      },
      { refData }
    )
    expect(fatal.unresolved).toMatch(/not found/)
    expect(fatal.partial).toBeUndefined()
  })
  it('mqtt topic filters with wildcards', () => {
    const t = compile(
      {
        preset: 'mqtt.message',
        params: { topic: 'cmsc/+/lights/#' },
        conditions: [{ path: 'json.on', op: 'eq', value: true }]
      },
      { refData }
    )
    expect(
      matchTrigger(
        t,
        ev({
          source: 'mqtt',
          type: 'mqtt.message',
          name: 'cmsc/lobby/lights/1',
          data: { topicMatch: 'cmsc/lobby/lights/1', json: { on: true } }
        })
      )
    ).toBe(true)
    expect(
      matchTrigger(
        t,
        ev({
          source: 'mqtt',
          type: 'mqtt.message',
          name: 'cmsc/lobby/lights/1',
          data: { topicMatch: 'cmsc/lobby/lights/1', json: { on: false } }
        })
      )
    ).toBe(false)
  })
  it('battery threshold matches numerically', () => {
    const t = compile(
      {
        preset: 'thorium.battery',
        params: { direction: 'below', threshold: 0.25 },
        conditions: []
      },
      { refData }
    )
    expect(
      matchTrigger(
        t,
        ev({ type: 'thorium.state', name: 'battery.below', data: { threshold: 0.25, level: 0.2 } })
      )
    ).toBe(true)
    expect(
      matchTrigger(
        t,
        ev({ type: 'thorium.state', name: 'battery.below', data: { threshold: 0.5, level: 0.4 } })
      )
    ).toBe(false)
  })
})
