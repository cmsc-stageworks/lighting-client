import { z } from 'zod'

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
    holdMs: z.number().int().min(0).optional()
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
