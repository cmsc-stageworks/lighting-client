import { DMX_CHANNELS } from '@shared/constants'

export const ENTTEC_START_OF_MSG = 0x7e
export const ENTTEC_END_OF_MSG = 0xe7
export const ENTTEC_SEND_DMX_RQ = 0x06
export const ENTTEC_DMX_START_CODE = 0x00

/**
 * Build the Enttec USB DMX Pro "Send DMX packet" message for a 513-byte frame
 * (index 1..512 are channel values; index 0 is ignored).
 */
export function buildEnttecPacket(frame: Uint8Array): Buffer {
  const len = DMX_CHANNELS + 1 // start code + 512 slots
  const out = Buffer.alloc(len + 5)
  out[0] = ENTTEC_START_OF_MSG
  out[1] = ENTTEC_SEND_DMX_RQ
  out[2] = len & 0xff
  out[3] = (len >> 8) & 0xff
  out[4] = ENTTEC_DMX_START_CODE
  for (let i = 1; i <= DMX_CHANNELS; i++) out[4 + i] = frame[i] ?? 0
  out[len + 4] = ENTTEC_END_OF_MSG
  return out
}
