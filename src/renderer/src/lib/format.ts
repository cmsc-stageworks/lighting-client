import type { ConnState, OutputHealth } from '@shared/types/state'

export { formatAgo } from '@shared/utils'

export function connLabel(state: ConnState): string {
  switch (state) {
    case 'connected':
      return 'Connected'
    case 'connecting':
      return 'Connecting'
    case 'reconnecting':
      return 'Reconnecting'
    case 'error':
      return 'Error'
    default:
      return 'Off'
  }
}

export type Tone = 'success' | 'warning' | 'danger' | 'muted' | 'info' | 'accent'

export function connTone(state: ConnState): Tone {
  switch (state) {
    case 'connected':
      return 'success'
    case 'connecting':
    case 'reconnecting':
      return 'warning'
    case 'error':
      return 'danger'
    default:
      return 'muted'
  }
}

export function outputTone(state: OutputHealth['state']): Tone {
  switch (state) {
    case 'ok':
      return 'success'
    case 'starting':
      return 'warning'
    case 'error':
      return 'danger'
    default:
      return 'muted'
  }
}

export function outputLabel(state: OutputHealth['state']): string {
  switch (state) {
    case 'ok':
      return 'OK'
    case 'starting':
      return 'Starting'
    case 'error':
      return 'Error'
    default:
      return 'Off'
  }
}

export function fmtTime(ts: number): string {
  const d = new Date(ts)
  return (
    d.toLocaleTimeString([], { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0')
  )
}

export function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms} ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(ms % 1000 ? 1 : 0)} s`
  return `${Math.round(ms / 60000)} min`
}

export function pct(v: number): string {
  return `${Math.round(v * 100)}%`
}

export function compactJson(v: unknown, max = 160): string {
  let s: string
  try {
    s = JSON.stringify(v)
  } catch {
    s = String(v)
  }
  if (!s) return ''
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}
