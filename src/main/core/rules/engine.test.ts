import { describe, expect, it, vi } from 'vitest'

vi.mock('../../logging', () => ({
  getLogger: () => ({
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined
  })
}))

import type { Action, Mapping, Scene } from '@shared/types/config'
import type { AppEvent } from '@shared/types/events'
import type { LightingMode } from '@shared/lightingMode'
import { RulesEngine } from './engine'
import type { ActionRunner } from './actions'

const scenes: Record<string, Pick<Scene, 'id' | 'name' | 'reducedEffectsCleared'>> = {
  safe: { id: 'safe', name: 'Alert 1 calm', reducedEffectsCleared: true },
  strobe: { id: 'strobe', name: 'Red strobe', reducedEffectsCleared: false }
}

const activate = (sceneId: string): Action => ({
  kind: 'activateScene',
  sceneId,
  target: 'event',
  layerId: null,
  holdMsOverride: null
})

function mapping(id: string, actions: Action[]): Mapping {
  return {
    id,
    name: id,
    enabled: true,
    category: 'General',
    triggers: [{ preset: 'thorium.alertLevel', params: { levels: ['1'] }, conditions: [] }],
    simulatorNames: [],
    actions,
    debounceMs: 0,
    notes: ''
  }
}

function alertEvent(over: Partial<AppEvent> = {}): AppEvent {
  return {
    id: 'e',
    ts: 0,
    source: 'thorium',
    type: 'thorium.state',
    name: 'alertLevel.changed',
    data: { level: '1', initial: false },
    matchedMappingIds: [],
    ...over
  }
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function setup(mappings: Mapping[]) {
  let mode: LightingMode = 'normal'
  const heldBack: string[] = []
  const run = vi.fn<(m: Mapping, e: AppEvent, a: Action[]) => Promise<void>>(async () => undefined)
  const runner = {
    sceneById: (id: string) => scenes[id],
    describe: (a: Action) => (a.kind === 'activateScene' ? `Activate ${a.sceneId}` : a.kind),
    run
  } as unknown as ActionRunner
  const engine = new RulesEngine(runner, {
    mode: () => mode,
    onHeldBack: (t) => heldBack.push(t)
  })
  engine.setMappings(mappings)
  return {
    engine,
    run,
    heldBack,
    setMode: (m: LightingMode) => {
      mode = m
    }
  }
}

describe('RulesEngine lighting mode gate', () => {
  it('Normal runs every action', () => {
    const t = setup([mapping('m', [activate('strobe'), { kind: 'blackout', on: true }])])
    const ev = alertEvent()
    t.engine.onEvent(ev)
    expect(t.run).toHaveBeenCalledOnce()
    expect(t.run.mock.calls[0][2]).toHaveLength(2)
    expect(ev.trace?.[0].heldBack).toBeUndefined()
    expect(t.heldBack).toEqual([])
  })

  it('Reduced runs cleared scenes and holds back the rest with a reason', () => {
    const t = setup([
      mapping('mixed', [activate('safe'), activate('strobe'), { kind: 'releaseAll' }])
    ])
    t.setMode('reduced')
    const ev = alertEvent()
    t.engine.onEvent(ev)
    const allowed = t.run.mock.calls[0][2]
    expect(allowed.map((a) => a.kind)).toEqual(['activateScene', 'releaseAll'])
    expect(ev.matchedMappingIds).toEqual(['mixed'])
    expect(ev.trace?.[0].actions).toEqual(['Activate safe', 'releaseAll'])
    expect(ev.trace?.[0].heldBack).toEqual([
      { action: 'Activate strobe', reason: expect.stringMatching(/"Red strobe" isn't cleared/) }
    ])
    expect(t.heldBack).toHaveLength(1)
  })

  it('a fully held-back mapping does not count as fired', () => {
    const t = setup([mapping('strobe', [activate('strobe')])])
    t.setMode('reduced')
    const ev = alertEvent()
    t.engine.onEvent(ev)
    expect(t.run).not.toHaveBeenCalled()
    expect(ev.matchedMappingIds).toEqual([])
    expect(ev.trace?.[0]).toMatchObject({ mappingId: 'strobe', actions: [] })
    expect(t.engine.statsSnapshot()).toEqual({})
  })

  it('Locked holds back Thorium events but lets a staff alert override through', () => {
    const t = setup([mapping('alert1', [activate('strobe')])])
    t.setMode('locked')
    const fromThorium = alertEvent()
    t.engine.onEvent(fromThorium)
    expect(t.run).not.toHaveBeenCalled()
    expect(fromThorium.trace?.[0].heldBack?.[0].reason).toMatch(/Locked/)

    const override = alertEvent({ source: 'ui', staffOrigin: true })
    t.engine.onEvent(override)
    expect(t.run).toHaveBeenCalledOnce()
    expect(override.matchedMappingIds).toEqual(['alert1'])
  })

  it('non-lighting actions run in every mode', () => {
    const publish: Action = { kind: 'publishMqtt', topic: 't', payload: '', qos: 0, retain: false }
    const t = setup([mapping('m', [publish, activate('strobe')])])
    t.setMode('locked')
    t.engine.onEvent(alertEvent())
    expect(t.run.mock.calls[0][2]).toEqual([publish])
  })

  it('evaluate reports what would be held back without running anything', () => {
    const t = setup([mapping('m', [activate('safe'), activate('strobe')])])
    t.setMode('reduced')
    const [r] = t.engine.evaluate(alertEvent())
    expect(r.allowed).toHaveLength(1)
    expect(r.heldBack).toHaveLength(1)
    expect(t.run).not.toHaveBeenCalled()
    expect(t.heldBack).toEqual([])
  })
})
