import type {
  AppConfig,
  Layer,
  Mapping,
  MqttSettings,
  Profile,
  Scene,
  SimulatorProfile,
  ThoriumSettings
} from './schema/config.schema'
import { CONFIG_SCHEMA_VERSION, LAYER_IDS, THORIUM_DEFAULT_PORT } from './constants'
import { shortId, uuid } from './utils'

/**
 * First-run defaults (PRD Appendix C). Simulator profiles are placeholders and are
 * No simulators or universes are assumed; the wizard builds those per site.
 */

export function seedLayers(): Layer[] {
  return [
    { id: LAYER_IDS.base, name: 'Base', priority: 0, locked: false },
    { id: LAYER_IDS.alert, name: 'Alert', priority: 10, locked: false },
    { id: LAYER_IDS.scene, name: 'Scene', priority: 20, locked: false },
    { id: LAYER_IDS.effect, name: 'Effect', priority: 30, locked: false },
    { id: LAYER_IDS.manual, name: 'Manual', priority: 40, locked: false },
    { id: LAYER_IDS.test, name: 'Test', priority: 90, locked: true },
    { id: LAYER_IDS.blackout, name: 'Blackout', priority: 100, locked: true }
  ]
}

/**
 * No simulators are assumed: names, universes and addresses are site-specific, so the
 * first-run wizard builds these (optionally by reading the running flights from Thorium).
 */
export function seedSimulators(): SimulatorProfile[] {
  return []
}

interface SeededScenes {
  scenes: Scene[]
  byKey: Record<string, Scene>
}

export function seedScenes(): SeededScenes {
  const byKey: Record<string, Scene> = {}
  const scenes: Scene[] = []
  const alertScene = (key: string, name: string, offset: number, color: string): void => {
    const s: Scene = {
      id: uuid(),
      name,
      category: 'Alert levels',
      color,
      addressing: 'relative',
      defaultUniverse: 1,
      // One trigger channel per alert level, full on. Replace with the values your controller expects.
      entries: [0, 1, 2, 3, 4, 5].map((ch) => ({ channel: ch, value: ch === offset ? 255 : 0 })),
      behavior: { kind: 'latch' },
      fadeInMs: 0,
      fadeOutMs: 0,
      defaultLayerId: LAYER_IDS.alert,
      showOnDashboard: true,
      notes:
        'Seeded starter. Channel offsets 0–5 are relative to the simulator base address; edit to match your controller’s trigger values.'
    }
    byKey[key] = s
    scenes.push(s)
  }
  alertScene('a5', 'Alert 5 – Normal', 0, '#3ddc97')
  alertScene('a4', 'Alert 4', 1, '#8ab4f8')
  alertScene('a3', 'Alert 3', 2, '#ffe066')
  alertScene('a2', 'Alert 2', 3, '#ffb454')
  alertScene('a1', 'Alert 1 – Red Alert', 4, '#ff5d5d')
  alertScene('ap', 'Alert P – Pause', 5, '#a78bfa')

  const flash: Scene = {
    id: uuid(),
    name: 'Flash',
    category: 'Effects',
    color: '#ffffff',
    addressing: 'relative',
    defaultUniverse: 1,
    entries: [{ channel: 6, value: 255 }],
    behavior: { kind: 'timed', holdMs: 400 },
    fadeInMs: 0,
    fadeOutMs: 0,
    defaultLayerId: LAYER_IDS.effect,
    showOnDashboard: true,
    notes: 'Seeded example of a timed effect scene.'
  }
  byKey.flash = flash
  scenes.push(flash)

  const work: Scene = {
    id: uuid(),
    name: 'Work lights',
    category: 'Manual',
    color: '#e6edf3',
    addressing: 'relative',
    defaultUniverse: 1,
    entries: [{ channel: 7, value: 255 }],
    behavior: { kind: 'latch' },
    fadeInMs: 0,
    fadeOutMs: 0,
    defaultLayerId: LAYER_IDS.manual,
    showOnDashboard: true,
    notes: 'Seeded example of a latching manual scene.'
  }
  byKey.work = work
  scenes.push(work)

  return { scenes, byKey }
}

export function seedMappings(scenes: Record<string, Scene>): Mapping[] {
  const alert = (level: string, key: string, name: string): Mapping => ({
    id: uuid(),
    name,
    enabled: true,
    category: 'Alert levels',
    trigger: {
      preset: 'thorium.alertLevel',
      params: { levels: [level], includeInitial: true },
      conditions: [],
      simulatorNames: []
    },
    actions: [
      {
        kind: 'activateScene',
        sceneId: scenes[key].id,
        target: 'event',
        layerId: null,
        holdMsOverride: null
      }
    ],
    debounceMs: 0,
    notes: 'Seeded. Alert level → scene on the Alert layer.'
  })
  return [
    alert('5', 'a5', 'Alert level 5 → Normal'),
    alert('4', 'a4', 'Alert level 4'),
    alert('3', 'a3', 'Alert level 3'),
    alert('2', 'a2', 'Alert level 2'),
    alert('1', 'a1', 'Alert level 1 → Red Alert'),
    alert('p', 'ap', 'Alert level P → Pause'),
    {
      id: uuid(),
      name: 'Thorium blackout action → Blackout',
      enabled: true,
      category: 'Blackout',
      trigger: {
        preset: 'thorium.action',
        params: { actions: ['blackout'] },
        conditions: [],
        simulatorNames: []
      },
      actions: [{ kind: 'blackout', on: true }],
      debounceMs: 0,
      notes: 'Seeded. FD "Blackout" station action turns the DMX blackout on.'
    },
    {
      id: uuid(),
      name: 'Thorium online action → release Blackout',
      enabled: true,
      category: 'Blackout',
      trigger: {
        preset: 'thorium.action',
        params: { actions: ['online'] },
        conditions: [],
        simulatorNames: []
      },
      actions: [{ kind: 'blackout', on: false }],
      debounceMs: 0,
      notes: 'Seeded.'
    },
    {
      id: uuid(),
      name: 'Thorium flash action → Flash scene',
      enabled: true,
      category: 'Effects',
      trigger: {
        preset: 'thorium.action',
        params: { actions: ['flash', 'spark'] },
        conditions: [],
        simulatorNames: []
      },
      actions: [
        {
          kind: 'activateScene',
          sceneId: scenes.flash.id,
          target: 'event',
          layerId: null,
          holdMsOverride: null
        }
      ],
      debounceMs: 250,
      notes: 'Seeded example.'
    },
    {
      id: uuid(),
      name: 'Flight reset → release effects',
      enabled: true,
      category: 'Flight',
      trigger: {
        preset: 'thorium.flight',
        params: { event: 'reset' },
        conditions: [],
        simulatorNames: []
      },
      actions: [
        { kind: 'releaseLayer', layerId: LAYER_IDS.effect, target: 'all' },
        { kind: 'releaseLayer', layerId: LAYER_IDS.scene, target: 'all' },
        { kind: 'releaseLayer', layerId: LAYER_IDS.manual, target: 'all' },
        { kind: 'blackout', on: false }
      ],
      debounceMs: 0,
      notes: 'Seeded. Clears stale scenes when the FD resets the flight.'
    },
    {
      id: uuid(),
      name: 'Example: generic key lights-* (disabled)',
      enabled: false,
      category: 'Effects',
      trigger: {
        preset: 'thorium.generic',
        params: { key: 'lights-*' },
        conditions: [],
        simulatorNames: []
      },
      actions: [
        {
          kind: 'activateScene',
          sceneId: scenes.flash.id,
          target: 'event',
          layerId: null,
          holdMsOverride: null
        }
      ],
      debounceMs: 0,
      notes: 'Seeded example of the Thorium "Generic" macro hook. Enable and edit.'
    }
  ]
}

export function seedThorium(hostname: string): ThoriumSettings {
  return {
    enabled: false,
    host: 'localhost',
    port: THORIUM_DEFAULT_PORT,
    secure: false,
    clientId: `lighting-${sanitize(hostname)}-${shortId()}`,
    clientLabel: `Lighting Client – ${hostname}`,
    scope: { mode: 'all' },
    unassignedBehavior: 'release',
    batteryThresholds: [0.5, 0.25, 0.1],
    reactorHeatThreshold: 0.9
  }
}

export function seedMqtt(hostname: string): MqttSettings {
  return {
    enabled: false,
    url: 'mqtt://localhost:1883',
    clientId: `cmsc-lighting-${sanitize(hostname)}-${shortId()}`,
    username: null,
    passwordSecretId: null,
    keepalive: 60,
    cleanSession: true,
    rejectUnauthorized: true,
    subscriptions: [],
    publish: {
      enabled: true,
      baseTopic: 'cmsc/lighting/{instanceName}',
      publishEvents: false,
      commandTopic: true,
      qos: 0
    }
  }
}

export function seedProfile(name: string, kind: Profile['kind'], hostname: string): Profile {
  const { scenes, byKey } = seedScenes()
  return {
    id: uuid(),
    name,
    kind,
    thorium: seedThorium(hostname),
    mqtt: seedMqtt(hostname),
    outputs: [],
    simulators: seedSimulators(),
    layers: seedLayers(),
    scenes,
    mappings: seedMappings(byKey),
    grandMaster: 1
  }
}

export function seedConfig(hostname: string): AppConfig {
  const profile = seedProfile('Central', 'central', hostname)
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    settings: {
      instanceName: sanitize(hostname) || 'lighting',
      launchAtLogin: false,
      startMinimized: false,
      closeToTray: true,
      sendZeroFrameOnExit: true,
      theme: 'dark',
      setupPinHash: null,
      eventLogSize: 2000,
      logLevel: 'info',
      window: null,
      wizardCompleted: false
    },
    profiles: [profile],
    activeProfileId: profile.id
  }
}

function sanitize(s: string): string {
  return s
    .toLowerCase()
    .replace(/\.(local|lan|home)$/, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
}
