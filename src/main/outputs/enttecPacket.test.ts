import { describe, expect, it } from 'vitest'
import {
  buildEnttecPacket,
  ENTTEC_END_OF_MSG,
  ENTTEC_SEND_DMX_RQ,
  ENTTEC_START_OF_MSG
} from './enttecPacket'

describe('buildEnttecPacket', () => {
  it('frames 512 channels with the Pro header and footer', () => {
    const frame = new Uint8Array(513)
    frame[1] = 255
    frame[512] = 7
    const p = buildEnttecPacket(frame)
    expect(p.length).toBe(513 + 5)
    expect(p[0]).toBe(ENTTEC_START_OF_MSG)
    expect(p[1]).toBe(ENTTEC_SEND_DMX_RQ)
    expect(p[2]).toBe(513 & 0xff)
    expect(p[3]).toBe(513 >> 8)
    expect(p[4]).toBe(0) // start code
    expect(p[5]).toBe(255) // channel 1
    expect(p[516]).toBe(7) // channel 512
    expect(p[517]).toBe(ENTTEC_END_OF_MSG)
  })
})
