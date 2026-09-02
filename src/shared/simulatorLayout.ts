import type { SimulatorProfile } from './schema/config.schema'
import { DMX_CHANNELS } from './constants'
import { eqIgnoreCase, uuid } from './utils'

/** Palette cycled through when generating simulator profiles. */
export const SIMULATOR_COLORS = [
  '#4cc9f0',
  '#f4a261',
  '#ff5d5d',
  '#8ab4f8',
  '#3ddc97',
  '#a78bfa',
  '#f472b6',
  '#ffe066'
]

export interface LayoutOptions {
  /** Universe the first simulator is placed on. */
  startUniverse: number
  /** DMX address the first simulator's block starts at. */
  startAddress: number
  /** Channels reserved per simulator; the next simulator starts this far along. */
  blockSize: number
  /** How many simulators share one universe before moving to the next (0 = all on one). */
  perUniverse: number
}

export const DEFAULT_LAYOUT: LayoutOptions = {
  startUniverse: 1,
  startAddress: 1,
  blockSize: 50,
  perUniverse: 0
}

export interface PlannedSimulator {
  name: string
  universe: number
  baseAddress: number
  color: string
  /** Set when the block would run past channel 512. */
  overflow: boolean
}

/**
 * Lay names out across universes/addresses. Pure so the wizard can preview exactly
 * what will be created and the Simulators page can reuse it for bulk re-addressing.
 */
export function planSimulatorLayout(
  names: string[],
  opts: LayoutOptions,
  startColorIndex = 0
): PlannedSimulator[] {
  const perUniverse = opts.perUniverse > 0 ? opts.perUniverse : Number.POSITIVE_INFINITY
  return names.map((name, i) => {
    const universeIndex = Math.floor(i / perUniverse)
    const slot = i % perUniverse
    const baseAddress = opts.startAddress + slot * opts.blockSize
    return {
      name,
      universe: opts.startUniverse + universeIndex,
      baseAddress,
      color: SIMULATOR_COLORS[(startColorIndex + i) % SIMULATOR_COLORS.length],
      overflow: baseAddress + opts.blockSize - 1 > DMX_CHANNELS
    }
  })
}

/** Turn a plan into profiles, keeping the ids of simulators that already exist by name. */
export function toSimulatorProfiles(
  plan: PlannedSimulator[],
  existing: SimulatorProfile[] = []
): SimulatorProfile[] {
  return plan.map((p) => {
    const prior = existing.find((e) => eqIgnoreCase(e.name, p.name))
    return {
      id: prior?.id ?? uuid(),
      name: p.name,
      universe: p.universe,
      baseAddress: Math.min(DMX_CHANNELS, Math.max(1, p.baseAddress)),
      color: prior?.color ?? p.color,
      confirmed: false
    }
  })
}
