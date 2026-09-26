import type { Action, Scene } from './schema/config.schema'

/**
 * Lighting modes protect guests with light sensitivity. A mode never changes DMX
 * values (the controller downstream owns the looks); it only decides which
 * automatic actions are allowed to fire. Direct staff actions in the app always work.
 */
export const LIGHTING_MODES = ['normal', 'reduced', 'locked'] as const
export type LightingMode = (typeof LIGHTING_MODES)[number]

export const LIGHTING_MODE_INFO: Record<
  LightingMode,
  { label: string; short: string; description: string; tone: 'success' | 'warning' | 'info' }
> = {
  normal: {
    label: 'Normal',
    short: 'Normal',
    description: 'Full lighting. Thorium, MQTT and the Dashboard all change the lights.',
    tone: 'success'
  },
  reduced: {
    label: 'Reduced Effects',
    short: 'Reduced',
    description:
      'Thorium and MQTT can only turn on scenes cleared for Reduced Effects. Turning scenes off still works.',
    tone: 'warning'
  },
  locked: {
    label: 'Locked',
    short: 'Locked',
    description: 'Nothing automatic changes the lights. Only staff actions in this app do.',
    tone: 'info'
  }
}

/** Mode restrictiveness, used to decide which direction a switch goes. */
export const LIGHTING_MODE_RANK: Record<LightingMode, number> = { normal: 0, reduced: 1, locked: 2 }

/** Everything the gate knows how to judge: mapping actions plus MQTT command topic commands. */
export type GateKind =
  | 'activateScene'
  | 'releaseScene'
  | 'releaseLayer'
  | 'releaseAll'
  | 'blackout'
  | 'grandMaster'
  | 'setChannel'
  | 'setLevel'
  | 'holdLevel'
  | 'alertLevel'
  | 'publishMqtt'
  | 'thoriumMutation'
  | 'setMappingGroup'

export interface GateRequest {
  kind: GateKind
  /** activateScene only */
  sceneName?: string
  /** activateScene only; a missing scene counts as not cleared */
  sceneCleared?: boolean
}

/**
 * Never held back. Switching mapping group changes no channel by itself; the
 * looks it brings in come from mappings that are gated on their own.
 */
const NON_LIGHTING: GateKind[] = ['publishMqtt', 'thoriumMutation', 'setMappingGroup']
const RELEASES: GateKind[] = ['releaseScene', 'releaseLayer', 'releaseAll']
/**
 * Allowed in Reduced Effects. A `setLevel` channel *tracks* a value the Flight
 * Director already set (Thorium's intensity slider); blocking it would freeze
 * the channel wherever it stood when the mode changed, which is worse for a
 * light-sensitive guest than letting it keep following — and it cannot flash,
 * because a single value with a fade is not an effect.
 */
const REDUCED_ALLOWED: GateKind[] = ['setLevel']
const GLOBAL_LABEL: Partial<Record<GateKind, string>> = {
  blackout: 'Blackout',
  grandMaster: 'Grand Master',
  setChannel: 'Raw channel control',
  setLevel: 'Channel level',
  // Deliberately *not* in REDUCED_ALLOWED: a `holdLevel` picks its own value and
  // drops it again after the hold, so a short one is a flash — the effect
  // Reduced Effects exists to hold back.
  holdLevel: 'Timed channel hold'
}

/**
 * Decide whether an automatic action may run. Returns `null` when allowed, or a
 * human-readable reason it is held back.
 *
 * `staffOrigin` is true when the action comes from a mapping fired by a staff
 * action in the app (e.g. the alert override). That is enough in Locked, but
 * Reduced Effects still filters it — only a direct button press bypasses clearance.
 */
export function gateAction(
  mode: LightingMode,
  req: GateRequest,
  ctx: { staffOrigin: boolean }
): string | null {
  if (mode === 'normal') return null
  if (NON_LIGHTING.includes(req.kind)) return null
  if (mode === 'locked')
    return ctx.staffOrigin ? null : 'Lights are Locked — only staff actions in this app change them'
  // reduced
  if (RELEASES.includes(req.kind) || req.kind === 'alertLevel') return null
  if (REDUCED_ALLOWED.includes(req.kind)) return null
  if (req.kind === 'activateScene')
    return req.sceneCleared
      ? null
      : `Reduced Effects: "${req.sceneName ?? '?'}" isn't cleared for Reduced Effects`
  return `Reduced Effects: ${GLOBAL_LABEL[req.kind] ?? req.kind} is manual-only`
}

/** Build a gate request for a mapping action. */
export function gateRequestForAction(
  action: Action,
  sceneById: (id: string) => Pick<Scene, 'name' | 'reducedEffectsCleared'> | undefined
): GateRequest {
  if (action.kind === 'activateScene') {
    const scene = sceneById(action.sceneId)
    return {
      kind: 'activateScene',
      sceneName: scene?.name,
      sceneCleared: scene?.reducedEffectsCleared ?? false
    }
  }
  return { kind: action.kind }
}

/** Local calendar day key (YYYY-MM-DD) used to decide "a new day". */
export function localDayKey(ts: number): string {
  const d = new Date(ts)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
