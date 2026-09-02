/**
 * Fixed-rate ticker with drift correction. Uses setTimeout chaining so a slow tick
 * does not queue up a burst of catch-up ticks; the next tick is scheduled relative
 * to the ideal timeline, clamped to "now" if we fell behind.
 */
export class Scheduler {
  private timer: ReturnType<typeof setTimeout> | null = null
  private intervalMs: number
  private nextAt = 0
  private running = false
  private tickTimes: number[] = []

  constructor(
    private onTick: (now: number) => void,
    fps: number
  ) {
    this.intervalMs = 1000 / fps
  }

  setFps(fps: number): void {
    this.intervalMs = 1000 / Math.max(1, fps)
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.nextAt = Date.now() + this.intervalMs
    this.schedule()
  }

  stop(): void {
    this.running = false
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  isRunning(): boolean {
    return this.running
  }

  /** Achieved ticks per second over the last 2 s. */
  achievedFps(now = Date.now()): number {
    const cutoff = now - 2000
    while (this.tickTimes.length && this.tickTimes[0] < cutoff) this.tickTimes.shift()
    return Math.round(this.tickTimes.length / 2)
  }

  private schedule(): void {
    if (!this.running) return
    const delay = Math.max(0, this.nextAt - Date.now())
    this.timer = setTimeout(() => this.fire(), delay)
  }

  private fire(): void {
    if (!this.running) return
    const now = Date.now()
    this.tickTimes.push(now)
    try {
      this.onTick(now)
    } catch (err) {
      // Never let a tick error kill the loop; the caller logs via its own try/catch too.
      console.error('[scheduler] tick error', err)
    }
    this.nextAt += this.intervalMs
    if (this.nextAt < now) this.nextAt = now + this.intervalMs // fell behind; resync
    this.schedule()
  }
}
