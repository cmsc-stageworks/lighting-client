import { describe, expect, it } from 'vitest'
import { gateAction } from '@shared/lightingMode'
import { commandGateRequest, parseMqttCommand, type MqttCommand } from './commands'

const scenes = [
  { name: 'Brig On', reducedEffectsCleared: true },
  { name: 'Strobe', reducedEffectsCleared: false }
]
const byName = (n: string): (typeof scenes)[number] | undefined =>
  scenes.find((s) => s.name.toLowerCase() === n.toLowerCase())

const cmd = (payload: unknown): MqttCommand => {
  const r = parseMqttCommand(payload)
  if (!r.ok) throw new Error(r.error)
  return r.cmd
}
const gate = (mode: 'normal' | 'reduced' | 'locked', payload: unknown): string | null =>
  gateAction(mode, commandGateRequest(cmd(payload), byName), { staffOrigin: false })

describe('MQTT command gating', () => {
  it('maps activateScene to its scene clearance', () => {
    expect(commandGateRequest(cmd({ action: 'activateScene', scene: 'brig on' }), byName)).toEqual({
      kind: 'activateScene',
      sceneName: 'Brig On',
      sceneCleared: true
    })
  })

  it('Reduced: cleared scenes and releases pass; the rest is held back', () => {
    expect(gate('reduced', { action: 'activateScene', scene: 'Brig On' })).toBeNull()
    expect(gate('reduced', { action: 'activateScene', scene: 'Strobe' })).not.toBeNull()
    expect(gate('reduced', { action: 'releaseAll' })).toBeNull()
    expect(gate('reduced', { action: 'blackout', on: true })).not.toBeNull()
    expect(gate('reduced', { action: 'grandMaster', value: 0.5 })).not.toBeNull()
    expect(
      gate('reduced', { action: 'setChannel', universe: 1, channel: 1, value: 255 })
    ).not.toBeNull()
  })

  it('an unknown scene is not held back in Reduced, so "not found" still surfaces', () => {
    expect(gate('reduced', { action: 'activateScene', scene: 'Nope' })).toBeNull()
  })

  it('Locked holds back every command', () => {
    expect(gate('locked', { action: 'activateScene', scene: 'Brig On' })).not.toBeNull()
    expect(gate('locked', { action: 'releaseAll' })).not.toBeNull()
    expect(gate('locked', { action: 'alertLevel', simulator: 'X', level: '5' })).not.toBeNull()
  })
})
