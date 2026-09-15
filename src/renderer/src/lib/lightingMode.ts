import { Contrast, Lock, Sun, type LucideIcon } from 'lucide-react'
import { create } from 'zustand'
import type { AppEvent } from '@shared/types/events'
import type { Mapping, Scene } from '@shared/types/config'
import { gateAction, gateRequestForAction, type LightingMode } from '@shared/lightingMode'

export const MODE_ICON: Record<LightingMode, LucideIcon> = {
  normal: Sun,
  reduced: Contrast,
  locked: Lock
}

/** Why an event's lighting changes were held back (empty when nothing was). */
export function heldBackReasons(e: AppEvent): string[] {
  if (e.name === 'lightingMode.heldBack' && typeof e.data.reason === 'string')
    return [`MQTT ${String(e.data.command)} — ${e.data.reason}`]
  const out: string[] = []
  for (const t of e.trace ?? [])
    for (const h of t.heldBack ?? []) out.push(`${t.mappingName}: ${h.action} — ${h.reason}`)
  return out
}

/** What Reduced Effects would hold back in this mapping, for setup-time hints. */
export function reducedHeldBack(mapping: Mapping, scenes: Scene[]): string[] {
  const byId = (id: string): Scene | undefined => scenes.find((s) => s.id === id)
  return mapping.actions
    .map((a) => gateAction('reduced', gateRequestForAction(a, byId), { staffOrigin: false }))
    .filter((r): r is string => r != null)
}

/** The one confirm dialog for switching modes, opened from the status bar, banner or Dashboard. */
export const useModeDialog = create<{
  target: LightingMode | null
  open: (m: LightingMode) => void
  close: () => void
}>((set) => ({
  target: null,
  open: (target) => set({ target }),
  close: () => set({ target: null })
}))
