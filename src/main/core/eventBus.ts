import { EventEmitter } from 'events'
import type { AppEvent, EventSource, EventType } from '@shared/types/events'
import { uuid } from '@shared/utils'

export interface EmitOptions {
  source: EventSource
  type: EventType
  name: string
  data?: Record<string, unknown>
  simulatorId?: string
  simulatorName?: string
}

/**
 * Central typed event bus. Sources call `emit`, the RulesEngine listens first
 * (so it can annotate `matchedMappingIds`), then the EventLog and publishers.
 */
export class EventBus {
  private emitter = new EventEmitter()
  private rateWindow: number[] = []

  constructor() {
    this.emitter.setMaxListeners(50)
  }

  create(opts: EmitOptions): AppEvent {
    return {
      id: uuid(),
      ts: Date.now(),
      source: opts.source,
      type: opts.type,
      name: opts.name,
      simulatorId: opts.simulatorId,
      simulatorName: opts.simulatorName,
      data: opts.data ?? {},
      matchedMappingIds: []
    }
  }

  emit(opts: EmitOptions): AppEvent {
    const ev = this.create(opts)
    this.publish(ev)
    return ev
  }

  publish(ev: AppEvent): void {
    this.rateWindow.push(ev.ts)
    this.emitter.emit('event', ev)
  }

  /** Listener order matters: rules engine subscribes first via `onFirst`. */
  onFirst(listener: (ev: AppEvent) => void): () => void {
    this.emitter.prependListener('event', listener)
    return () => this.emitter.off('event', listener)
  }

  on(listener: (ev: AppEvent) => void): () => void {
    this.emitter.on('event', listener)
    return () => this.emitter.off('event', listener)
  }

  /** Events per second over the last 5 s window. */
  rate(now = Date.now()): number {
    const cutoff = now - 5000
    while (this.rateWindow.length && this.rateWindow[0] < cutoff) this.rateWindow.shift()
    return Math.round((this.rateWindow.length / 5) * 10) / 10
  }
}
