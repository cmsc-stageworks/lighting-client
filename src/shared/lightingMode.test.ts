import { describe, expect, it } from 'vitest'
import {
  gateAction,
  gateRequestForAction,
  localDayKey,
  LIGHTING_MODES,
  type GateKind
} from './lightingMode'

const auto = { staffOrigin: false }
const staff = { staffOrigin: true }
const cleared = { kind: 'activateScene' as const, sceneName: 'Alert 5', sceneCleared: true }
const notCleared = { kind: 'activateScene' as const, sceneName: 'Strobe', sceneCleared: false }
const kinds: GateKind[] = [
  'releaseScene',
  'releaseLayer',
  'releaseAll',
  'blackout',
  'grandMaster',
  'setChannel',
  'setLevel',
  'holdLevel',
  'alertLevel',
  'publishMqtt',
  'thoriumMutation'
]

describe('gateAction', () => {
  it('Normal allows everything', () => {
    for (const ctx of [auto, staff]) {
      expect(gateAction('normal', cleared, ctx)).toBeNull()
      expect(gateAction('normal', notCleared, ctx)).toBeNull()
      for (const kind of kinds) expect(gateAction('normal', { kind }, ctx)).toBeNull()
    }
  })

  it('never holds back non-lighting actions', () => {
    for (const mode of LIGHTING_MODES)
      for (const ctx of [auto, staff]) {
        expect(gateAction(mode, { kind: 'publishMqtt' }, ctx)).toBeNull()
        expect(gateAction(mode, { kind: 'thoriumMutation' }, ctx)).toBeNull()
      }
  })

  it('Reduced allows cleared scenes and releases only', () => {
    expect(gateAction('reduced', cleared, auto)).toBeNull()
    expect(gateAction('reduced', notCleared, auto)).toMatch(/"Strobe" isn't cleared/)
    for (const kind of ['releaseScene', 'releaseLayer', 'releaseAll', 'alertLevel'] as const)
      expect(gateAction('reduced', { kind }, auto)).toBeNull()
    for (const kind of ['blackout', 'grandMaster', 'setChannel'] as const)
      expect(gateAction('reduced', { kind }, auto)).toMatch(/manual-only/)
  })

  it('Reduced holds back a timed hold, which is a flash when it is short', () => {
    // Unlike a follow, a holdLevel picks its own value and drops it again.
    expect(gateAction('reduced', { kind: 'holdLevel' }, auto)).toMatch(/manual-only/)
    expect(gateAction('reduced', { kind: 'holdLevel' }, staff)).toMatch(/manual-only/)
  })

  it('Reduced keeps a level following, Locked still stops it', () => {
    // Freezing a follower mid-show leaves the channel wherever it happened to
    // be; letting it track the FD's slider is the gentler outcome.
    expect(gateAction('reduced', { kind: 'setLevel' }, auto)).toBeNull()
    expect(gateAction('locked', { kind: 'setLevel' }, auto)).toMatch(/Locked/)
    expect(gateAction('locked', { kind: 'setLevel' }, staff)).toBeNull()
  })

  it('Reduced still filters mappings fired by a staff action', () => {
    expect(gateAction('reduced', notCleared, staff)).not.toBeNull()
    expect(gateAction('reduced', { kind: 'blackout' }, staff)).not.toBeNull()
  })

  it('Locked holds back every automatic lighting action but lets staff-origin through', () => {
    expect(gateAction('locked', cleared, auto)).toMatch(/Locked/)
    for (const kind of kinds.filter((k) => k !== 'publishMqtt' && k !== 'thoriumMutation'))
      expect(gateAction('locked', { kind }, auto)).toMatch(/Locked/)
    expect(gateAction('locked', notCleared, staff)).toBeNull()
    expect(gateAction('locked', { kind: 'releaseAll' }, staff)).toBeNull()
  })
})

describe('gateRequestForAction', () => {
  it('looks up clearance for activateScene and treats missing scenes as not cleared', () => {
    const scenes = { a: { name: 'A', reducedEffectsCleared: true } }
    const lookup = (id: string): (typeof scenes)['a'] | undefined =>
      scenes[id as keyof typeof scenes]
    const act = (sceneId: string) =>
      ({
        kind: 'activateScene',
        sceneId,
        target: 'event',
        layerId: null,
        holdMsOverride: null
      }) as const
    expect(gateRequestForAction(act('a'), lookup)).toEqual({
      kind: 'activateScene',
      sceneName: 'A',
      sceneCleared: true
    })
    expect(gateRequestForAction(act('zzz'), lookup).sceneCleared).toBe(false)
    expect(gateRequestForAction({ kind: 'blackout', on: true }, lookup)).toEqual({
      kind: 'blackout'
    })
  })
})

describe('localDayKey', () => {
  it('formats the local calendar day', () => {
    expect(localDayKey(new Date(2026, 8, 3, 23, 59).getTime())).toBe('2026-09-03')
    expect(localDayKey(new Date(2026, 8, 4, 0, 1).getTime())).toBe('2026-09-04')
  })
})
