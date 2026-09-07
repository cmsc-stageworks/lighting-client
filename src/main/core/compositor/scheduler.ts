/**
 * Fixed-rate ticker with drift correction. Uses setTimeout chaining so a slow tick
 * does not queue up a burst of catch-up ticks; the next tick is scheduled relative
 * to the ideal timeline, clamped to "now" if we fell behind.
 */
/** Sliding window for the achieved-FPS gauge. */
const FPS_WINDOW_MS = 2000

export class Scheduler {
  private timer: ReturnType<typeof setTimeout> | null = null
  private intervalMs: number
  private nextAt = 0
  private running = false
  private tickTimes: number[] = []

  private tickErrors = 0

  constructor(
    private onTick: (now: number) => void,
    fps: number,
    private onError: (err: unknown, count: number) => void = (err) =>
      console.error('[scheduler] tick error', err)
  ) {
    this.intervalMs = 1000 / fps
  }

  /** Number of tick callbacks that have thrown since start (never resets the loop). */
  errorCount(): number {
    return this.tickErrors
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
    this.trimTickTimes(now)
    return Math.round(this.tickTimes.length / (FPS_WINDOW_MS / 1000))
  }

  private trimTickTimes(now: number): void {
    const cutoff = now - FPS_WINDOW_MS
    let i = 0
    while (i < this.tickTimes.length && this.tickTimes[i] < cutoff) i++
    if (i > 0) this.tickTimes.splice(0, i)
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
    this.trimTickTimes(now)
    try {
      this.onTick(now)
    } catch (err) {
      // Never let a tick error kill the loop.
      this.tickErrors++
      try {
        this.onError(err, this.tickErrors)
      } catch {
        /* the error reporter must not kill the loop either */
      }
    }
    this.nextAt += this.intervalMs
    if (this.nextAt < now) this.nextAt = now + this.intervalMs // fell behind; resync
    this.schedule()
  }
}
