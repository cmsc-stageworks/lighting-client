import { describe, expect, it } from 'vitest'
import type { SimulatorProfile } from './schema/config.schema'
import { DEFAULT_LAYOUT, planSimulatorLayout, toSimulatorProfiles } from './simulatorLayout'

describe('planSimulatorLayout', () => {
  it('spaces blocks by block size on one universe by default', () => {
    const plan = planSimulatorLayout(['A', 'B', 'C'], DEFAULT_LAYOUT)
    expect(plan.map((p) => [p.universe, p.baseAddress])).toEqual([
      [1, 1],
      [1, 51],
      [1, 101]
    ])
    expect(plan.every((p) => !p.overflow)).toBe(true)
  })
  it('rolls onto the next universe after N simulators', () => {
    const plan = planSimulatorLayout(['A', 'B', 'C', 'D'], {
      startUniverse: 10,
      startAddress: 1,
      blockSize: 50,
      perUniverse: 3
    })
    expect(plan.map((p) => [p.universe, p.baseAddress])).toEqual([
      [10, 1],
      [10, 51],
      [10, 101],
      [11, 1]
    ])
  })
  it('flags only the blocks that run past channel 512', () => {
    const plan = planSimulatorLayout(['A', 'B'], {
      startUniverse: 1,
      startAddress: 400,
      blockSize: 100,
      perUniverse: 0
    })
    // A occupies 400–499 and fits; B starts at 500 and would need 500–599.
    expect(plan.map((p) => [p.baseAddress, p.overflow])).toEqual([
      [400, false],
      [500, true]
    ])
  })
  it('assigns distinct colors and keeps ids/colors of simulators that already exist', () => {
    const existing: SimulatorProfile[] = [
      { id: 'keep', name: 'b', universe: 99, baseAddress: 7, color: '#123456', confirmed: true }
    ]
    const profiles = toSimulatorProfiles(planSimulatorLayout(['A', 'B'], DEFAULT_LAYOUT), existing)
    expect(profiles[0].color).not.toBe(profiles[1].color)
    expect(profiles[1].id).toBe('keep')
    expect(profiles[1].color).toBe('#123456')
    expect(profiles[1].universe).toBe(1)
    expect(profiles[1].confirmed).toBe(false)
  })
})
