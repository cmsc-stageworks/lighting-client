import type { AppEvent } from '@shared/types/events'

/** Fixed-size ring buffer of events plus a 10 Hz batch forwarder. */
export class EventLog {
  private buffer: AppEvent[] = []
  private pending: AppEvent[] = []
  private timer: ReturnType<typeof setInterval> | null = null
  private seenNames = new Map<string, number>()

  constructor(
    private capacity: number,
    private forward: (batch: AppEvent[]) => void
  ) {}

  setCapacity(n: number): void {
    this.capacity = n
    if (this.buffer.length > n) this.buffer.splice(0, this.buffer.length - n)
  }

  append(ev: AppEvent): void {
    this.buffer.push(ev)
    if (this.buffer.length > this.capacity) this.buffer.shift()
    if (ev.type === 'thorium.event') this.seenNames.set(ev.name, ev.ts)
    this.pending.push(ev)
    if (!this.timer) {
      this.timer = setInterval(() => this.flush(), 100)
    }
  }

  private flush(): void {
    if (this.pending.length === 0) {
      if (this.timer) clearInterval(this.timer)
      this.timer = null
      return
    }
    const batch = this.pending
    this.pending = []
    // Cap what we push to the renderer per tick; the ring buffer keeps everything.
    this.forward(batch.length > 200 ? batch.slice(batch.length - 200) : batch)
  }

  recent(limit: number): AppEvent[] {
    return this.buffer.slice(Math.max(0, this.buffer.length - limit))
  }

  clear(): void {
    this.buffer = []
  }

  /** Thorium event names observed, most recent first. */
  seenEventNames(limit = 200): string[] {
    return [...this.seenNames.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([n]) => n)
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}
