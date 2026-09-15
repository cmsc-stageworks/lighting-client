import { z } from 'zod'
import type { Scene } from '@shared/types/config'
import type { GateRequest } from '@shared/lightingMode'

/** JSON commands accepted on `<base>/cmd` (PRD F-MQTT-07). */
export const MqttCommandSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('activateScene'),
    scene: z.string().min(1),
    simulator: z.string().optional(),
    layer: z.string().optional()
  }),
  z.object({
    action: z.literal('releaseScene'),
    scene: z.string().min(1),
    simulator: z.string().optional()
  }),
  z.object({ action: z.literal('releaseLayer'), layer: z.string().min(1) }),
  z.object({ action: z.literal('releaseAll') }),
  z.object({ action: z.literal('blackout'), on: z.boolean() }),
  z.object({ action: z.literal('grandMaster'), value: z.number().min(0).max(1) }),
  z.object({
    action: z.literal('setChannel'),
    universe: z.number().int().min(1),
    channel: z.number().int().min(1).max(512),
    value: z.number().int().min(0).max(255),
    // Capped at 10 min: a runaway publisher must not accumulate long-lived timers.
    holdMs: z.number().int().min(0).max(600_000).optional()
  }),
  z.object({
    action: z.literal('alertLevel'),
    simulator: z.string().min(1),
    level: z.string().min(1)
  })
])
export type MqttCommand = z.infer<typeof MqttCommandSchema>

export function parseMqttCommand(
  payload: unknown
): { ok: true; cmd: MqttCommand } | { ok: false; error: string } {
  const r = MqttCommandSchema.safeParse(payload)
  if (r.success) return { ok: true, cmd: r.data }
  return {
    ok: false,
    error: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
  }
}

/**
 * How the lighting-mode gate should judge a command. The command topic counts as
 * an automatic source. An unknown scene is reported as cleared so the caller's
 * "scene not found" warning still surfaces in Reduced Effects.
 */
export function commandGateRequest(
  cmd: MqttCommand,
  sceneByName: (name: string) => Pick<Scene, 'name' | 'reducedEffectsCleared'> | undefined
): GateRequest {
  if (cmd.action === 'activateScene') {
    const scene = sceneByName(cmd.scene)
    return {
      kind: 'activateScene',
      sceneName: scene?.name ?? cmd.scene,
      sceneCleared: scene ? scene.reducedEffectsCleared : true
    }
  }
  return { kind: cmd.action }
}
