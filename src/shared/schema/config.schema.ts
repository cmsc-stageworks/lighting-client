import { z } from 'zod'
import { CONFIG_SCHEMA_VERSION, DMX_CHANNELS, MAX_FPS, SACN_MAX_UNIVERSE } from '../constants'

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

const id = z.string().min(1)
const name = z.string().trim().min(1).max(80)
const hexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/)
  .default('#4cc9f0')
const universe = z.number().int().min(1).max(SACN_MAX_UNIVERSE)
const channel = z.number().int().min(1).max(DMX_CHANNELS)
const dmxValue = z.number().int().min(0).max(255)
const fps = z.number().int().min(1).max(MAX_FPS)
const qos = z.union([z.literal(0), z.literal(1), z.literal(2)])

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const AppSettingsSchema = z.object({
  instanceName: name.default('lighting'),
  launchAtLogin: z.boolean().default(false),
  startMinimized: z.boolean().default(false),
  closeToTray: z.boolean().default(true),
  sendZeroFrameOnExit: z.boolean().default(true),
  theme: z.enum(['dark', 'light', 'system']).default('dark'),
  setupPinHash: z.string().nullable().default(null),
  eventLogSize: z.number().int().min(100).max(20000).default(2000),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  window: z
    .object({
      width: z.number().int(),
      height: z.number().int(),
      x: z.number().int().optional(),
      y: z.number().int().optional()
    })
    .nullable()
    .default(null),
  wizardCompleted: z.boolean().default(false)
})
export type AppSettings = z.infer<typeof AppSettingsSchema>

// ---------------------------------------------------------------------------
// Thorium
// ---------------------------------------------------------------------------

export const ThoriumScopeSchema = z.discriminatedUnion('mode', [
  /** Only the simulator the FD assigned this client to. */
  z.object({ mode: z.literal('follow-assignment') }),
  /** Every simulator of the flight the FD assigned this client to. */
  z.object({ mode: z.literal('assigned-flight') }),
  z.object({ mode: z.literal('pinned'), simulatorNames: z.array(name).default([]) }),
  z.object({ mode: z.literal('all') })
])
export type ThoriumScope = z.infer<typeof ThoriumScopeSchema>

export const ThoriumSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  host: z.string().trim().min(1).default('localhost'),
  port: z.number().int().min(1).max(65535).default(4444),
  secure: z.boolean().default(false),
  clientId: z.string().min(1),
  clientLabel: z.string().min(1).default('Lighting Client'),
  scope: ThoriumScopeSchema.default({ mode: 'all' }),
  /** What to do with active scenes when the FD un-assigns this client (assignment modes only). */
  unassignedBehavior: z.enum(['release', 'hold']).default('release'),
  batteryThresholds: z.array(z.number().min(0).max(1)).default([0.5, 0.25, 0.1]),
  reactorHeatThreshold: z.number().min(0).max(1).default(0.9)
})
export type ThoriumSettings = z.infer<typeof ThoriumSettingsSchema>

// ---------------------------------------------------------------------------
// MQTT
// ---------------------------------------------------------------------------

export const MqttSubscriptionSchema = z.object({
  id,
  topic: z.string().trim().min(1),
  qos: qos.default(0),
  enabled: z.boolean().default(true)
})
export type MqttSubscription = z.infer<typeof MqttSubscriptionSchema>

export const MqttSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  url: z.string().trim().default('mqtt://localhost:1883'),
  clientId: z.string().min(1),
  username: z.string().nullable().default(null),
  passwordSecretId: z.string().nullable().default(null),
  keepalive: z.number().int().min(5).max(3600).default(60),
  cleanSession: z.boolean().default(true),
  rejectUnauthorized: z.boolean().default(true),
  subscriptions: z.array(MqttSubscriptionSchema).default([]),
  publish: z
    .object({
      enabled: z.boolean().default(true),
      baseTopic: z.string().trim().min(1).default('cmsc/lighting/{instanceName}'),
      publishEvents: z.boolean().default(false),
      commandTopic: z.boolean().default(true),
      qos: qos.default(0)
    })
    .default({
      enabled: true,
      baseTopic: 'cmsc/lighting/{instanceName}',
      publishEvents: false,
      commandTopic: true,
      qos: 0
    })
})
export type MqttSettings = z.infer<typeof MqttSettingsSchema>

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

/** Optional guard: only these channels are ever transmitted (others sent as 0). */
const channelRange = z.object({ from: channel, to: channel }).nullable().default(null)

export const SacnOutputSchema = z.object({
  id,
  name,
  enabled: z.boolean().default(true),
  driver: z.literal('sacn'),
  universe,
  channelRange,
  sacn: z.object({
    mode: z.enum(['multicast', 'unicast']).default('multicast'),
    unicastAddress: z.string().nullable().default(null),
    priority: z.number().int().min(0).max(200).default(100),
    sourceName: z.string().max(63).default('CMSC Lighting Client'),
    iface: z.string().nullable().default(null),
    fps: fps.default(40),
    keepAliveMs: z.number().int().min(100).max(2000).default(800)
  })
})
export const EnttecOutputSchema = z.object({
  id,
  name,
  enabled: z.boolean().default(true),
  driver: z.literal('enttec-pro'),
  universe,
  channelRange,
  enttec: z.object({
    portPath: z.string().default(''),
    serialNumber: z.string().nullable().default(null),
    fps: fps.default(40)
  })
})
export const OutputSchema = z.discriminatedUnion('driver', [SacnOutputSchema, EnttecOutputSchema])
export type Output = z.infer<typeof OutputSchema>
export type SacnOutput = z.infer<typeof SacnOutputSchema>
export type EnttecOutput = z.infer<typeof EnttecOutputSchema>

// ---------------------------------------------------------------------------
// Simulators, layers, scenes
// ---------------------------------------------------------------------------

export const SimulatorProfileSchema = z.object({
  id,
  name,
  universe,
  baseAddress: channel.default(1),
  color: hexColor,
  confirmed: z.boolean().default(false)
})
export type SimulatorProfile = z.infer<typeof SimulatorProfileSchema>

export const LayerSchema = z.object({
  id,
  name,
  priority: z.number().int().min(0).max(1000),
  locked: z.boolean().default(false)
})
export type Layer = z.infer<typeof LayerSchema>

export const ChannelEntrySchema = z.object({
  channel: z.number().int().min(0).max(DMX_CHANNELS),
  value: dmxValue,
  universe: universe.optional()
})
export type ChannelEntry = z.infer<typeof ChannelEntrySchema>

export const SceneBehaviorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('latch') }),
  z.object({ kind: z.literal('timed'), holdMs: z.number().int().min(0).max(3_600_000) })
])
export type SceneBehavior = z.infer<typeof SceneBehaviorSchema>

export const SceneSchema = z.object({
  id,
  name,
  category: z.string().trim().max(40).default('General'),
  color: hexColor,
  addressing: z.enum(['absolute', 'relative']).default('relative'),
  defaultUniverse: universe.default(1),
  entries: z.array(ChannelEntrySchema).default([]),
  behavior: SceneBehaviorSchema.default({ kind: 'latch' }),
  fadeInMs: z.number().int().min(0).max(600_000).default(0),
  fadeOutMs: z.number().int().min(0).max(600_000).default(0),
  defaultLayerId: id,
  showOnDashboard: z.boolean().default(true),
  notes: z.string().max(2000).default('')
})
export type Scene = z.infer<typeof SceneSchema>

// ---------------------------------------------------------------------------
// Triggers, actions, mappings
// ---------------------------------------------------------------------------

export const ConditionOpSchema = z.enum([
  'eq',
  'neq',
  'contains',
  'gt',
  'gte',
  'lt',
  'lte',
  'regex',
  'glob',
  'exists',
  'notExists'
])
export type ConditionOp = z.infer<typeof ConditionOpSchema>

export const ConditionSchema = z.object({
  path: z.string().trim().min(1),
  op: ConditionOpSchema,
  value: z.union([z.string(), z.number(), z.boolean()]).optional()
})
export type Condition = z.infer<typeof ConditionSchema>

export const TriggerSchema = z.object({
  preset: z.string().min(1),
  params: z.record(z.string(), z.unknown()).default({}),
  conditions: z.array(ConditionSchema).default([]),
  /** Empty = any simulator in scope. Otherwise only events from these simulators (by Thorium name). */
  simulatorNames: z.array(z.string().trim().min(1)).default([])
})
export type Trigger = z.infer<typeof TriggerSchema>

export const ActionTargetSchema = z.union([
  z.literal('event'),
  z.literal('all'),
  z.object({ simulatorName: name })
])
export type ActionTarget = z.infer<typeof ActionTargetSchema>

export const ThoriumMutationActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('triggerMacro'), macroName: z.string().min(1) }),
  z.object({ kind: z.literal('setAlertLevel'), level: z.enum(['1', '2', '3', '4', '5', 'p']) }),
  z.object({
    kind: z.literal('notify'),
    title: z.string().min(1),
    body: z.string().default(''),
    color: z
      .enum(['primary', 'secondary', 'success', 'danger', 'warning', 'info', 'light', 'dark'])
      .default('info')
  })
])

export const ActionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('activateScene'),
    sceneId: id,
    target: ActionTargetSchema.default('event'),
    layerId: id.nullable().default(null),
    holdMsOverride: z.number().int().min(0).nullable().default(null)
  }),
  z.object({
    kind: z.literal('releaseScene'),
    sceneId: id,
    target: ActionTargetSchema.default('event')
  }),
  z.object({
    kind: z.literal('releaseLayer'),
    layerId: id,
    target: z.union([z.literal('event'), z.literal('all')]).default('all')
  }),
  z.object({ kind: z.literal('releaseAll') }),
  z.object({ kind: z.literal('blackout'), on: z.boolean() }),
  z.object({
    kind: z.literal('publishMqtt'),
    topic: z.string().min(1),
    payload: z.string().default(''),
    qos: qos.default(0),
    retain: z.boolean().default(false)
  }),
  z.object({ kind: z.literal('thoriumMutation'), mutation: ThoriumMutationActionSchema })
])
export type Action = z.infer<typeof ActionSchema>

export const MappingSchema = z.object({
  id,
  name,
  enabled: z.boolean().default(true),
  category: z.string().trim().max(40).default('General'),
  trigger: TriggerSchema,
  actions: z.array(ActionSchema).default([]),
  debounceMs: z.number().int().min(0).max(600_000).default(0),
  notes: z.string().max(2000).default('')
})
export type Mapping = z.infer<typeof MappingSchema>

// ---------------------------------------------------------------------------
// Profile + root
// ---------------------------------------------------------------------------

export const ProfileSchema = z.object({
  id,
  name,
  kind: z.enum(['central', 'single-ship']).default('central'),
  thorium: ThoriumSettingsSchema,
  mqtt: MqttSettingsSchema,
  outputs: z.array(OutputSchema).default([]),
  simulators: z.array(SimulatorProfileSchema).default([]),
  layers: z.array(LayerSchema).default([]),
  scenes: z.array(SceneSchema).default([]),
  mappings: z.array(MappingSchema).default([]),
  grandMaster: z.number().min(0).max(1).default(1)
})
export type Profile = z.infer<typeof ProfileSchema>

export const AppConfigSchema = z.object({
  schemaVersion: z.literal(CONFIG_SCHEMA_VERSION),
  settings: AppSettingsSchema,
  profiles: z.array(ProfileSchema).min(1),
  activeProfileId: id
})
export type AppConfig = z.infer<typeof AppConfigSchema>

/** Partial import/export document (scenes, mappings, simulators, layers). */
export const PartialConfigSchema = z.object({
  kind: z.literal('partial'),
  schemaVersion: z.literal(CONFIG_SCHEMA_VERSION),
  scenes: z.array(SceneSchema).default([]),
  mappings: z.array(MappingSchema).default([]),
  simulators: z.array(SimulatorProfileSchema).default([]),
  layers: z.array(LayerSchema).default([])
})
export type PartialConfig = z.infer<typeof PartialConfigSchema>

// ---------------------------------------------------------------------------
// Cross-field validation used before saving a profile
// ---------------------------------------------------------------------------

export function validateProfileReferences(profile: Profile): string[] {
  const errors: string[] = []
  const layerIds = new Set(profile.layers.map((l) => l.id))
  const sceneIds = new Set(profile.scenes.map((s) => s.id))

  const dup = (items: { name: string }[], what: string): void => {
    const seen = new Map<string, number>()
    for (const it of items) {
      const key = it.name.trim().toLowerCase()
      seen.set(key, (seen.get(key) ?? 0) + 1)
    }
    for (const [k, n] of seen) if (n > 1) errors.push(`Duplicate ${what} name "${k}"`)
  }
  dup(profile.scenes, 'scene')
  dup(profile.mappings, 'mapping')
  dup(profile.outputs, 'output')
  dup(profile.simulators, 'simulator')
  dup(profile.layers, 'layer')

  for (const s of profile.scenes) {
    if (!layerIds.has(s.defaultLayerId)) errors.push(`Scene "${s.name}" references a missing layer`)
    for (const e of s.entries) {
      if (s.addressing === 'absolute' && e.channel < 1)
        errors.push(`Scene "${s.name}" has an absolute channel below 1`)
    }
  }
  for (const m of profile.mappings) {
    for (const a of m.actions) {
      if ((a.kind === 'activateScene' || a.kind === 'releaseScene') && !sceneIds.has(a.sceneId))
        errors.push(`Mapping "${m.name}" references a missing scene`)
      if (a.kind === 'activateScene' && a.layerId && !layerIds.has(a.layerId))
        errors.push(`Mapping "${m.name}" references a missing layer`)
      if (a.kind === 'releaseLayer' && !layerIds.has(a.layerId))
        errors.push(`Mapping "${m.name}" references a missing layer`)
    }
  }
  for (const o of profile.outputs) {
    if (o.driver === 'sacn' && o.sacn.mode === 'unicast' && !o.sacn.unicastAddress)
      errors.push(`Output "${o.name}" is unicast but has no address`)
    if (o.driver === 'enttec-pro' && !o.enttec.portPath && !o.enttec.serialNumber)
      errors.push(`Output "${o.name}" has no serial port selected`)
  }
  return errors
}
