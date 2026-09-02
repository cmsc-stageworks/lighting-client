import { describe, expect, it } from 'vitest'
import { DONE, envelopeIsAnimating, envelopeLevel, type EnvelopeState } from './envelope'

const base: EnvelopeState = {
  startedAt: 1000,
  fadeInMs: 1000,
  fadeOutMs: 500,
  startLevel: 0,
  releaseStartedAt: null,
  releaseLevel: 1
}

describe('envelope', () => {
  it('fades in linearly', () => {
    expect(envelopeLevel(base, 1000)).toBe(0)
    expect(envelopeLevel(base, 1500)).toBeCloseTo(0.5)
    expect(envelopeLevel(base, 2000)).toBe(1)
    expect(envelopeLevel(base, 9000)).toBe(1)
  })
  it('no fade-in jumps to 1', () => {
    expect(envelopeLevel({ ...base, fadeInMs: 0 }, 1000)).toBe(1)
  })
  it('starts from startLevel on replacement', () => {
    expect(envelopeLevel({ ...base, startLevel: 0.5 }, 1000)).toBe(0.5)
    expect(envelopeLevel({ ...base, startLevel: 0.5 }, 1500)).toBeCloseTo(0.75)
  })
  it('fades out from releaseLevel and finishes', () => {
    const e = { ...base, releaseStartedAt: 3000, releaseLevel: 1 }
    expect(envelopeLevel(e, 3000)).toBe(1)
    expect(envelopeLevel(e, 3250)).toBeCloseTo(0.5)
    expect(envelopeLevel(e, 3500)).toBe(DONE)
    expect(envelopeLevel({ ...e, fadeOutMs: 0 }, 3000)).toBe(DONE)
  })
  it('reports animating state', () => {
    expect(envelopeIsAnimating(base, 1500)).toBe(true)
    expect(envelopeIsAnimating(base, 2500)).toBe(false)
    expect(envelopeIsAnimating({ ...base, releaseStartedAt: 2500 }, 2600)).toBe(true)
  })
})
