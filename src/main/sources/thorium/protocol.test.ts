import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WebSocketServer, type WebSocket } from 'ws'

vi.mock('../../logging', () => ({
  getLogger: () => ({
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined
  })
}))

import { SubscriptionsClient } from './protocol'

interface Msg {
  type: string
  id?: string
  payload?: unknown
}

function startServer(opts: { autoPong?: boolean } = {}): Promise<{
  wss: WebSocketServer
  port: number
  sockets: WebSocket[]
  received: Msg[]
}> {
  return new Promise((resolve) => {
    const sockets: WebSocket[] = []
    const received: Msg[] = []
    const wss = new WebSocketServer({
      port: 0,
      handleProtocols: () => 'graphql-ws',
      autoPong: opts.autoPong ?? true
    })
    wss.on('connection', (ws) => {
      sockets.push(ws)
      ws.on('message', (raw) => {
        const m = JSON.parse(raw.toString()) as Msg
        received.push(m)
        if (m.type === 'connection_init') ws.send(JSON.stringify({ type: 'connection_ack' }))
        if (m.type === 'start')
          ws.send(
            JSON.stringify({
              type: 'data',
              id: m.id,
              payload: { data: { events: { event: 'hello' } } }
            })
          )
      })
    })
    wss.on('listening', () =>
      resolve({ wss, port: (wss.address() as { port: number }).port, sockets, received })
    )
  })
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const until = async (fn: () => boolean, ms = 2000): Promise<void> => {
  const t = Date.now()
  while (!fn()) {
    if (Date.now() - t > ms) throw new Error('timeout')
    await wait(10)
  }
}

describe('SubscriptionsClient', () => {
  let srv: Awaited<ReturnType<typeof startServer>>
  let client: SubscriptionsClient
  beforeEach(async () => {
    srv = await startServer()
  })
  afterEach(async () => {
    client?.close()
    await new Promise<void>((r) => srv.wss.close(() => r()))
  })

  it('performs init/ack, starts subscriptions and receives data', async () => {
    client = new SubscriptionsClient(
      () => `ws://127.0.0.1:${srv.port}/graphql`,
      () => ({ clientId: 'c1' })
    )
    const got: unknown[] = []
    client.subscribe('subscription { events }', undefined, (d) => got.push(d))
    client.connect()
    await until(() => client.isConnected())
    await until(() => got.length === 1)
    expect(got[0]).toEqual({ events: { event: 'hello' } })
    expect(srv.received[0]).toMatchObject({ type: 'connection_init', payload: { clientId: 'c1' } })
    expect(srv.received[1]).toMatchObject({ type: 'start', id: '1' })
  })

  it('sends stop on unsubscribe and terminate on close', async () => {
    client = new SubscriptionsClient(
      () => `ws://127.0.0.1:${srv.port}/graphql`,
      () => ({})
    )
    const unsub = client.subscribe('subscription { events }', undefined, () => undefined)
    client.connect()
    await until(() => client.isConnected())
    unsub()
    await until(() => srv.received.some((m) => m.type === 'stop'))
    client.close()
    await until(() => srv.received.some((m) => m.type === 'connection_terminate'))
  })

  it('reconnects and resubscribes after the socket drops', async () => {
    client = new SubscriptionsClient(
      () => `ws://127.0.0.1:${srv.port}/graphql`,
      () => ({})
    )
    let count = 0
    client.subscribe('subscription { events }', undefined, () => count++)
    const disconnected: string[] = []
    client.on('disconnected', (r: string) => disconnected.push(r))
    client.connect()
    await until(() => count === 1)
    srv.sockets[0].terminate()
    await until(() => disconnected.length === 1)
    await until(() => count === 2, 5000)
    expect(client.reconnects).toBe(1)
    expect(srv.received.filter((m) => m.type === 'start').length).toBe(2)
  })

  it('stays connected on a server that never sends ka (pings answered by the socket)', async () => {
    client = new SubscriptionsClient(
      () => `ws://127.0.0.1:${srv.port}/graphql`,
      () => ({}),
      { pingIntervalMs: 40, timeoutMs: 150 }
    )
    const disconnected: string[] = []
    client.on('disconnected', (r: string) => disconnected.push(r))
    client.connect()
    await until(() => client.isConnected())
    await wait(500)
    expect(client.isConnected()).toBe(true)
    expect(disconnected).toEqual([])
    expect(client.reconnects).toBe(0)
  })

  it('reconnects when pings go unanswered', async () => {
    await new Promise<void>((r) => srv.wss.close(() => r()))
    srv = await startServer({ autoPong: false })
    client = new SubscriptionsClient(
      () => `ws://127.0.0.1:${srv.port}/graphql`,
      () => ({}),
      { pingIntervalMs: 40, timeoutMs: 150 }
    )
    const disconnected: string[] = []
    client.on('disconnected', (r: string) => disconnected.push(r))
    client.connect()
    await until(() => client.isConnected())
    await until(() => disconnected.length >= 1, 3000)
    await until(() => client.reconnects >= 1, 3000)
  })
})
