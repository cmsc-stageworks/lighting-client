import type { OutputHealth, TestReport } from '@shared/types/state'

export interface OutputDriver {
  readonly id: string
  readonly universe: number
  start(): Promise<void>
  stop(): Promise<void>
  /** Called every scheduler tick with the current composited frame (513 bytes, index 1..512). */
  deliver(frame: Uint8Array, changed: boolean, now: number): void
  health(): OutputHealth
  test(): Promise<TestReport>
  /** Send an all-zero frame and wait for it to leave (used on exit). */
  sendZero(): Promise<void>
}

export function friendlyErrorMessage(err: unknown): string {
  const e = err as { code?: string; message?: string } | undefined
  const code = e?.code ?? ''
  const msg = e?.message ?? String(err)
  switch (code) {
    case 'ENOENT':
      return 'Port not found — is the device plugged in?'
    case 'EACCES':
    case 'EPERM':
      return 'Permission denied opening the port'
    case 'EBUSY':
      return 'Port is busy (another program has it open)'
    case 'EADDRNOTAVAIL':
      return 'The selected network interface address is not available'
    case 'EADDRINUSE':
      return 'Address already in use (another sACN sender?)'
    case 'ENETUNREACH':
    case 'EHOSTUNREACH':
      return 'Network unreachable — check the interface or destination address'
    default:
      return msg
  }
}
