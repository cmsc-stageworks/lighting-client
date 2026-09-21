import type { LevelFade, LevelHold, LevelSource } from './schema/config.schema'
import { MAX_HOLD_MS } from './constants'
import { clamp, resolvePath } from './utils'

/**
 * Value mapping for the `setLevel` action: an event number (Thorium's lighting
 * intensity is 0–1) scaled onto a DMX value. Pure, so the renderer can preview
 * the curve and the main process can use the same maths at 40 Hz.
 */

/** Map `input` through the source's range, curve and inversion to a 0–255 DMX value. */
export function scaleLevel(input: number, s: LevelSource): number {
  const span = s.inMax - s.inMin
  // A zero-width input range would divide by zero; treat it as "always at the top",
  // which is what an operator asking for `0..0` most likely means (a fixed value).
  let t = span === 0 ? 1 : (input - s.inMin) / span
  t = clamp(t, 0, 1)
  if (s.invert) t = 1 - t
  if (s.curve === 'square') t = t * t
  else if (s.curve === 'sqrt') t = Math.sqrt(t)
  return clamp(Math.round(s.outMin + (s.outMax - s.outMin) * t), 0, 255)
}

/** Pull the source number out of an event payload. Returns null when absent or not numeric. */
export function readLevelInput(data: unknown, path: string): number | null {
  const { found, value } = resolvePath(data, path)
  if (!found) return null
  const n = typeof value === 'string' ? Number(value) : value
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

/**
 * How long this level change should take. `fromEvent` follows Thorium, which
 * publishes the *destination* intensity immediately plus the duration its own
 * client uses to ramp there (`lightingFadeLights`), so the fade is ours to run.
 */
export function resolveFadeMs(fade: LevelFade, data: unknown): number {
  if (fade.kind === 'none') return 0
  if (fade.kind === 'fixed') return fade.ms
  const n = readLevelInput(data, fade.path)
  return n != null && n >= 0 ? Math.min(Math.round(n), 600_000) : fade.fallbackMs
}

/**
 * How long a held level stays up. `fromEvent` is the point of the `holdLevel`
 * action: the event says *how long*, the action says *what value*. Returns null
 * for a latch, which is "until something releases it".
 */
export function resolveHoldMs(hold: LevelHold, data: unknown): number | null {
  if (hold.kind === 'latch') return null
  if (hold.kind === 'fixed') return hold.ms
  const n = readLevelInput(data, hold.path)
  // A negative duration is as meaningless as a missing one, so both fall back.
  const ms = n != null && n >= 0 ? n * (hold.units === 'seconds' ? 1000 : 1) : hold.fallbackMs
  return clamp(Math.round(ms), 0, MAX_HOLD_MS)
}
