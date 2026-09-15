import { EventEmitter } from 'events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeSnapshot } from '@shared/types/state'

const calls = vi.hoisted(() => ({ setImage: 0, setContextMenu: 0, setToolTip: 0 }))

vi.mock('electron', async () => {
  const { EventEmitter: EE } = await import('events')
  class FakeTray extends EE {
    setImage(): void {
      calls.setImage++
    }
    setContextMenu(): void {
      calls.setContextMenu++
    }
    setToolTip(): void {
      calls.setToolTip++
    }
  }
  return {
    app: { quit: () => undefined },
    Menu: { buildFromTemplate: (t: unknown) => t },
    nativeImage: { createFromDataURL: () => ({ resize: () => ({}) }) },
    Tray: FakeTray
  }
})

import { createTray, statusColor, statusLines } from './tray'

function snap(over: Partial<RuntimeSnapshot> = {}): RuntimeSnapshot {
  return {
    ts: 0,
    thorium: {
      state: 'connected',
      flights: [],
      simulatorsInScope: [],
      assignment: null,
      waitingForAssignment: false,
      scopeWarnings: [],
      eventsPerSec: 0,
      reconnects: 0,
      since: null
    },
    mqtt: { state: 'connected', subscriptions: [], messagesPerSec: 0, reconnects: 0 },
    outputs: { a: { state: 'ok', fps: 40, lastSendAt: 0 } },
    compositor: { blackout: false, grandMaster: 1, active: [], universes: [1] },
    perf: { eventsPerSec: 0, schedulerFps: 40 },
    mappingsStats: {},
    unresolvedMappings: {},
    alertOverrides: {},
    lightingMode: { mode: 'normal', since: 0, staleDay: false, heldBack: { count: 0, last: null } },
    ...over
  } as RuntimeSnapshot
}

describe('tray', () => {
  beforeEach(() => {
    calls.setImage = 0
    calls.setContextMenu = 0
    calls.setToolTip = 0
  })

  it('statusColor prioritises blackout/error over warn over ok', () => {
    expect(statusColor(snap())).toBe('#3ddc97')
    expect(statusColor(snap({ thorium: { ...snap().thorium, state: 'reconnecting' } }))).toBe(
      '#ffb454'
    )
    expect(
      statusColor(snap({ outputs: { a: { state: 'error', fps: 0, lastSendAt: null } } }))
    ).toBe('#ff5d5d')
    expect(statusColor(snap({ compositor: { ...snap().compositor, blackout: true } }))).toBe(
      '#ff5d5d'
    )
  })

  it('does not touch the native icon or menu when nothing it shows changed', () => {
    const emitter = new EventEmitter()
    const services = Object.assign(emitter, {
      snapshot: () => snap(),
      setBlackout: vi.fn(),
      releaseAll: vi.fn()
    }) as unknown as import('../services').Services

    createTray(services, () => null)
    const afterInit = { ...calls }

    // Fire many snapshots that differ only in volatile fields the tray ignores.
    for (let i = 0; i < 25; i++) {
      emitter.emit('snapshot', snap({ ts: i, thorium: { ...snap().thorium, eventsPerSec: i } }))
    }
    expect(calls.setImage).toBe(afterInit.setImage)
    expect(calls.setContextMenu).toBe(afterInit.setContextMenu)

    // A real status change does rebuild.
    emitter.emit('snapshot', snap({ compositor: { ...snap().compositor, blackout: true } }))
    expect(calls.setImage).toBe(afterInit.setImage + 1)
    expect(calls.setContextMenu).toBe(afterInit.setContextMenu + 1)
  })

  it('statusLines summarises the three connections', () => {
    expect(statusLines(snap())).toEqual([
      'Thorium: connected',
      'MQTT: connected',
      'Outputs: 1/1 ok',
      'Lighting: Normal'
    ])
    expect(statusLines(snap({ lightingMode: { ...snap().lightingMode, mode: 'locked' } }))[3]).toBe(
      'Lighting: Locked'
    )
  })
})
