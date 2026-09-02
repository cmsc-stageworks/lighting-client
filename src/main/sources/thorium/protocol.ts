import { EventEmitter } from 'events'
import WebSocket from 'ws'
import { getLogger } from '../../logging'

const log = getLogger('thorium.ws')

/**
 * Minimal client for the legacy `subscriptions-transport-ws` protocol used by
 * Thorium (Apollo Server 2). Messages:
 *   → connection_init {payload}   ← connection_ack | connection_error
 *   ← ka (keep-alive)
 *   → start {id, payload:{query, variables}}   ← data {id, payload} | error {id, payload} | complete {id}
 *   → stop {id}
 *   → connection_terminate
 */

export type SubscriptionHandler = (data: Record<string, unknown> | null, errors?: unknown[]) => void

interface Sub {
  id: string
  query: string
  variables: Record<string, unknown> | undefined
  handler: SubscriptionHandler
}

export interface ProtocolEvents {
  connected: () => void
  disconnected: (reason: string) => void
  error: (err: Error) => void
}

export class SubscriptionsClient extends EventEmitter {
  private ws: WebSocket | null = null
  private subs = new Map<string, Sub>()
  private seq = 0
  private closedByUser = true
  private backoffMs = 1000
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private kaTimer: ReturnType<typeof setTimeout> | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private acked = false
  public reconnects = 0

  /**
   * Liveness is checked with WebSocket-level ping/pong, which the `ws` server answers
   * automatically. Thorium's Apollo Server 2 is installed without `keepAlive`, so it never
   * sends protocol-level `ka` frames; those are treated as a bonus signal when present.
   */
  constructor(
    private url: () => string,
    private connectionParams: () => Record<string, unknown>,
    private liveness: { pingIntervalMs: number; timeoutMs: number } = {
      pingIntervalMs: 15000,
      timeoutMs: 40000
    }
  ) {
    super()
  }

  isConnected(): boolean {
    return this.acked && this.ws?.readyState === WebSocket.OPEN
  }

  connect(): void {
    this.closedByUser = false
    this.open()
  }

  private open(): void {
    if (this.ws) return
    const url = this.url()
    log.debug(`connecting ${url}`)
    let ws: WebSocket
    try {
      ws = new WebSocket(url, 'graphql-ws', { handshakeTimeout: 5000 })
    } catch (err) {
      this.emit('error', err as Error)
      this.scheduleReconnect('open failed')
      return
    }
    this.ws = ws
    this.acked = false
    ws.on('open', () => {
      this.send({ type: 'connection_init', payload: this.connectionParams() })
    })
    ws.on('message', (raw) => this.onMessage(raw.toString()))
    ws.on('error', (err) => {
      log.debug(`socket error: ${err.message}`)
      this.emit('error', err)
    })
    ws.on('pong', () => this.resetKa())
    ws.on('close', (code, reason) => {
      const wasAcked = this.acked
      this.ws = null
      this.acked = false
      this.stopLiveness()
      if (wasAcked)
        this.emit(
          'disconnected',
          `socket closed (${code}${reason?.length ? ' ' + reason.toString() : ''})`
        )
      this.scheduleReconnect(`closed ${code}`)
    })
  }

  private onMessage(text: string): void {
    let msg: { type: string; id?: string; payload?: unknown }
    try {
      msg = JSON.parse(text)
    } catch {
      return
    }
    switch (msg.type) {
      case 'connection_ack':
        this.acked = true
        this.backoffMs = 1000
        this.resetKa()
        this.startPings()
        for (const s of this.subs.values()) this.sendStart(s)
        this.emit('connected')
        break
      case 'connection_error':
        this.emit('error', new Error(`connection_error: ${JSON.stringify(msg.payload)}`))
        break
      case 'ka':
        this.resetKa()
        break
      case 'data': {
        this.resetKa()
        const s = msg.id ? this.subs.get(msg.id) : undefined
        if (!s) break
        const payload = (msg.payload ?? {}) as {
          data?: Record<string, unknown>
          errors?: unknown[]
        }
        try {
          s.handler(payload.data ?? null, payload.errors)
        } catch (err) {
          log.error(`subscription handler error (${s.id})`, err)
        }
        break
      }
      case 'error': {
        const s = msg.id ? this.subs.get(msg.id) : undefined
        log.warn(`subscription error ${msg.id}: ${JSON.stringify(msg.payload)}`)
        s?.handler(null, [msg.payload])
        break
      }
      case 'complete':
        break
      default:
        break
    }
  }

  private startPings(): void {
    if (this.pingTimer) clearInterval(this.pingTimer)
    this.pingTimer = setInterval(() => {
      const ws = this.ws
      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.ping()
        } catch {
          /* socket is going away; the close handler reconnects */
        }
      }
    }, this.liveness.pingIntervalMs)
  }

  /** Any sign of life (pong, ka, data) pushes the dead-socket deadline out. */
  private resetKa(): void {
    this.clearKa()
    this.kaTimer = setTimeout(() => {
      log.warn(`no pong or message for ${this.liveness.timeoutMs} ms, reconnecting`)
      this.ws?.terminate()
    }, this.liveness.timeoutMs)
  }

  /** Stop the dead-socket deadline only (pings keep flowing). */
  private clearKa(): void {
    if (this.kaTimer) clearTimeout(this.kaTimer)
    this.kaTimer = null
  }

  /** Stop both the deadline and the ping interval (socket is gone). */
  private stopLiveness(): void {
    this.clearKa()
    if (this.pingTimer) clearInterval(this.pingTimer)
    this.pingTimer = null
  }

  private scheduleReconnect(reason: string): void {
    if (this.closedByUser || this.reconnectTimer) return
    const jitter = 0.8 + Math.random() * 0.4
    const delay = Math.round(this.backoffMs * jitter)
    log.debug(`reconnect in ${delay} ms (${reason})`)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.reconnects++
      this.open()
    }, delay)
    this.backoffMs = Math.min(30000, this.backoffMs * 2)
  }

  private send(obj: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj))
  }

  private sendStart(s: Sub): void {
    this.send({ id: s.id, type: 'start', payload: { query: s.query, variables: s.variables } })
  }

  subscribe(
    query: string,
    variables: Record<string, unknown> | undefined,
    handler: SubscriptionHandler
  ): () => void {
    const id = String(++this.seq)
    const sub: Sub = { id, query, variables, handler }
    this.subs.set(id, sub)
    if (this.isConnected()) this.sendStart(sub)
    return () => {
      if (this.subs.delete(id) && this.isConnected()) this.send({ id, type: 'stop' })
    }
  }

  unsubscribeAll(): void {
    for (const id of this.subs.keys()) if (this.isConnected()) this.send({ id, type: 'stop' })
    this.subs.clear()
  }

  close(): void {
    this.closedByUser = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this.stopLiveness()
    const ws = this.ws
    this.ws = null
    this.acked = false
    if (ws) {
      try {
        if (ws.readyState === WebSocket.OPEN)
          ws.send(JSON.stringify({ type: 'connection_terminate' }))
        ws.close()
      } catch {
        /* ignore */
      }
    }
  }

  /** Force a reconnect now (e.g. settings changed). */
  reconnectNow(): void {
    const wasUser = this.closedByUser
    this.close()
    this.closedByUser = wasUser
    if (!wasUser) {
      this.backoffMs = 1000
      this.open()
    }
  }
}
