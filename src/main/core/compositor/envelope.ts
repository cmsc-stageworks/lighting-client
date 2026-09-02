/**
 * Fade envelope math for an active scene instance. Pure, so it is unit-tested directly.
 *
 * Level goes 0 → 1 over fadeInMs (starting from `startLevel` when a scene is
 * re-activated mid-fade), stays at 1, then on release goes from `releaseLevel`
 * back to 0 over fadeOutMs. `DONE` signals the instance can be dropped.
 */
export const DONE = -1

export interface EnvelopeState {
  startedAt: number
  fadeInMs: number
  fadeOutMs: number
  /** level at startedAt (1 for a replacement of an already-full instance, 0 for a fresh one) */
  startLevel: number
  releaseStartedAt: number | null
  /** level captured when release began */
  releaseLevel: number
}

export function envelopeLevel(e: EnvelopeState, now: number): number {
  if (e.releaseStartedAt != null) {
    if (e.fadeOutMs <= 0) return DONE
    const t = (now - e.releaseStartedAt) / e.fadeOutMs
    if (t >= 1) return DONE
    return e.releaseLevel * (1 - Math.max(0, t))
  }
  if (e.fadeInMs <= 0) return 1
  const t = (now - e.startedAt) / e.fadeInMs
  if (t >= 1) return 1
  return e.startLevel + (1 - e.startLevel) * Math.max(0, t)
}

/** True while the envelope is still moving (needs re-render every tick). */
export function envelopeIsAnimating(e: EnvelopeState, now: number): boolean {
  if (e.releaseStartedAt != null) return true
  if (e.fadeInMs <= 0) return false
  return now - e.startedAt < e.fadeInMs
}
