import { describe, expect, it } from 'vitest'
import type { LevelSource } from './schema/config.schema'
import { readLevelInput, resolveFadeMs, scaleLevel, resolveHoldMs } from './levels'

const src = (over: Partial<LevelSource> = {}): LevelSource => ({
  path: 'intensity',
  inMin: 0,
  inMax: 1,
  outMin: 0,
  outMax: 255,
  curve: 'linear',
  invert: false,
  ...over
})

describe('scaleLevel', () => {
  it('maps Thorium intensity onto the full DMX range', () => {
    expect(scaleLevel(0, src())).toBe(0)
    expect(scaleLevel(0.5, src())).toBe(128)
    expect(scaleLevel(1, src())).toBe(255)
  })

  it('clamps outside the input range', () => {
    expect(scaleLevel(-3, src())).toBe(0)
    expect(scaleLevel(9, src())).toBe(255)
  })

  it('honours a narrowed output range', () => {
    expect(scaleLevel(0, src({ outMin: 40, outMax: 200 }))).toBe(40)
    expect(scaleLevel(1, src({ outMin: 40, outMax: 200 }))).toBe(200)
  })

  it('inverts and curves', () => {
    expect(scaleLevel(0, src({ invert: true }))).toBe(255)
    expect(scaleLevel(0.5, src({ curve: 'square' }))).toBe(64)
    expect(scaleLevel(0.25, src({ curve: 'sqrt' }))).toBe(128)
  })

  it('treats a zero-width input range as a fixed value', () => {
    expect(scaleLevel(0, src({ inMin: 1, inMax: 1, outMax: 120 }))).toBe(120)
  })

  it('maps a descending output range', () => {
    expect(scaleLevel(1, src({ outMin: 255, outMax: 0 }))).toBe(0)
  })
})

describe('readLevelInput', () => {
  it('reads dot-paths and coerces numeric strings', () => {
    expect(readLevelInput({ intensity: 0.4 }, 'intensity')).toBe(0.4)
    expect(readLevelInput({ a: { b: '7' } }, 'a.b')).toBe(7)
  })

  it('returns null for missing or non-numeric values', () => {
    expect(readLevelInput({}, 'intensity')).toBeNull()
    expect(readLevelInput({ intensity: 'dim' }, 'intensity')).toBeNull()
    expect(readLevelInput({ intensity: null }, 'intensity')).toBeNull()
  })
})

describe('resolveFadeMs', () => {
  it('takes Thorium transition duration when following the event', () => {
    const fade = { kind: 'fromEvent', path: 'transitionDuration', fallbackMs: 250 } as const
    expect(resolveFadeMs(fade, { transitionDuration: 5000 })).toBe(5000)
    expect(resolveFadeMs(fade, { transitionDuration: null })).toBe(250)
    expect(resolveFadeMs(fade, {})).toBe(250)
  })

  it('handles fixed and snap', () => {
    expect(resolveFadeMs({ kind: 'fixed', ms: 800 }, {})).toBe(800)
    expect(resolveFadeMs({ kind: 'none' }, { transitionDuration: 5000 })).toBe(0)
  })
})

describe('resolveHoldMs', () => {
  const hold = { kind: 'fromEvent', path: 'duration', units: 'ms', fallbackMs: 750 } as const

  it('takes the hold from the event', () => {
    expect(resolveHoldMs(hold, { duration: 4000 })).toBe(4000)
  })

  it('converts seconds, which is how Thorium times most things', () => {
    expect(resolveHoldMs({ ...hold, units: 'seconds' }, { duration: 2.5 })).toBe(2500)
  })

  it('falls back when the event has no usable duration', () => {
    expect(resolveHoldMs(hold, {})).toBe(750)
    expect(resolveHoldMs(hold, { duration: null })).toBe(750)
    expect(resolveHoldMs(hold, { duration: -5 })).toBe(750)
  })

  it('clamps a runaway duration to an hour', () => {
    expect(resolveHoldMs({ ...hold, units: 'seconds' }, { duration: 99999 })).toBe(3_600_000)
  })

  it('handles fixed and latch', () => {
    expect(resolveHoldMs({ kind: 'fixed', ms: 300 }, { duration: 4000 })).toBe(300)
    expect(resolveHoldMs({ kind: 'latch' }, { duration: 4000 })).toBeNull()
  })
})
