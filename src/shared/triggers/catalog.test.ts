import { describe, expect, it } from 'vitest'
import type { AppEvent } from '../types/events'
import type { ReferenceData } from '../types/state'
import { compileTrigger, listPresets, summarizeTrigger } from './catalog'
import { compile, matchEvent } from './matcher'

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
        conditions: [],
        simulatorNames: []
      },
      { refData }
    )
    expect(
      matchEvent(t, ev({ type: 'thorium.state', name: 'alertLevel.changed', data: { level: '1' } }))
    ).toBe(true)
    expect(
      matchEvent(t, ev({ type: 'thorium.state', name: 'alertLevel.changed', data: { level: 'p' } }))
    ).toBe(true)
    expect(
      matchEvent(t, ev({ type: 'thorium.state', name: 'alertLevel.changed', data: { level: '3' } }))
    ).toBe(false)
    expect(
      matchEvent(t, ev({ type: 'thorium.event', name: 'alertLevel.changed', data: { level: '1' } }))
    ).toBe(false)
  })
  it('includeInitial=false ignores the connect-time event', () => {
    const t = compile(
      {
        preset: 'thorium.alertLevel',
        params: { levels: ['1'], includeInitial: false },
        conditions: [],
        simulatorNames: []
      },
      { refData }
    )
    expect(
      matchEvent(
        t,
        ev({
          type: 'thorium.state',
          name: 'alertLevel.changed',
          data: { level: '1', initial: true }
        })
      )
    ).toBe(false)
    expect(
      matchEvent(
        t,
        ev({
          type: 'thorium.state',
          name: 'alertLevel.changed',
          data: { level: '1', initial: false }
        })
      )
    ).toBe(true)
  })
  it('generic key supports globs', () => {
    const t = compile(
      {
        preset: 'thorium.generic',
        params: { key: 'lights-*' },
        conditions: [],
        simulatorNames: []
      },
      { refData }
    )
    expect(matchEvent(t, ev({ name: 'generic', data: { key: 'lights-hyperspace' } }))).toBe(true)
    expect(matchEvent(t, ev({ name: 'generic', data: { key: 'sound-1' } }))).toBe(false)
  })
  it('macro by name resolves through reference data', () => {
    const t = compile(
      {
        preset: 'thorium.macro',
        params: { macroName: 'red alert lights' },
        conditions: [],
        simulatorNames: []
      },
      { refData }
    )
    expect(t.unresolved).toBeUndefined()
    expect(matchEvent(t, ev({ name: 'triggerMacroAction', data: { macroId: 'm1' } }))).toBe(true)
    const missing = compile(
      {
        preset: 'thorium.macro',
        params: { macroName: 'nope' },
        conditions: [],
        simulatorNames: []
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
        conditions: [],
        simulatorNames: []
      },
      { refData }
    )
    expect(
      matchEvent(b, ev({ name: 'triggerMacroButton', data: { buttonId: 'b1', configId: 'c1' } }))
    ).toBe(true)
    const tl = compile(
      {
        preset: 'thorium.timelineItem',
        params: { missionName: 'Rescue', stepName: 'Arrival' },
        conditions: [],
        simulatorNames: []
      },
      { refData }
    )
    expect(
      matchEvent(
        tl,
        ev({ name: 'triggerMacros', data: { macros: [{ stepId: 'i1', event: 'generic' }] } })
      )
    ).toBe(true)
    expect(
      matchEvent(tl, ev({ name: 'triggerMacros', data: { macros: [{ stepId: 'zz' }] } }))
    ).toBe(false)
  })
  it('simulator restriction is case-insensitive', () => {
    const t = compile(
      {
        preset: 'custom.event',
        params: { eventName: 'shieldRaised' },
        conditions: [],
        simulatorNames: ['magellan', 'Phoenix']
      },
      { refData }
    )
    expect(matchEvent(t, ev({ name: 'shieldRaised', simulatorName: 'Magellan' }))).toBe(true)
    expect(matchEvent(t, ev({ name: 'shieldRaised', simulatorName: 'Cassini' }))).toBe(false)
    expect(matchEvent(t, ev({ name: 'shieldRaised', simulatorName: 'phoenix' }))).toBe(true)
    expect(matchEvent(t, ev({ name: 'shieldRaised' }))).toBe(false)
  })
  it('mqtt topic filters with wildcards', () => {
    const t = compile(
      {
        preset: 'mqtt.message',
        params: { topic: 'cmsc/+/lights/#' },
        conditions: [{ path: 'json.on', op: 'eq', value: true }],
        simulatorNames: []
      },
      { refData }
    )
    expect(
      matchEvent(
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
      matchEvent(
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
        conditions: [],
        simulatorNames: []
      },
      { refData }
    )
    expect(
      matchEvent(
        t,
        ev({ type: 'thorium.state', name: 'battery.below', data: { threshold: 0.25, level: 0.2 } })
      )
    ).toBe(true)
    expect(
      matchEvent(
        t,
        ev({ type: 'thorium.state', name: 'battery.below', data: { threshold: 0.5, level: 0.4 } })
      )
    ).toBe(false)
  })
})
