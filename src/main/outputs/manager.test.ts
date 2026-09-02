import { describe, expect, it, vi } from 'vitest'

vi.mock('../logging', () => ({
  getLogger: () => ({
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined
  })
}))

import { maskFrame } from './manager'

describe('maskFrame', () => {
  it('passes frames through when no range is set', () => {
    const f = new Uint8Array(513).fill(9)
    expect(maskFrame(f, null)).toBe(f)
  })
  it('zeroes channels outside the range (inclusive, order-insensitive)', () => {
    const f = new Uint8Array(513).fill(200)
    const m = maskFrame(f, { from: 60, to: 51 })
    expect(m[50]).toBe(0)
    expect(m[51]).toBe(200)
    expect(m[60]).toBe(200)
    expect(m[61]).toBe(0)
    expect(m[512]).toBe(0)
  })
})
