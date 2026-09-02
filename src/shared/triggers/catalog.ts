import { z } from 'zod'
import type { Condition } from '../schema/config.schema'
import type { EventType } from '../types/events'
import type { ReferenceData } from '../types/state'
import { ALERT_LEVELS, LIGHTING_ACTIONS, THORIUM_TRIGGER_ACTIONS } from '../constants'
import { eqIgnoreCase } from '../utils'

/**
 * Trigger presets. Each preset is UI sugar over the generic matcher: it describes
 * a form (for the renderer) and compiles its params into event types/names/conditions
 * (for the rules engine). Both processes import this file so behavior is identical.
 */

export type FieldDescriptor =
  | {
      key: string
      label: string
      kind: 'text'
      placeholder?: string
      help?: string
      autocomplete?: 'eventName' | 'macroName' | 'buttonName' | 'missionName' | 'systemName'
    }
  | {
      key: string
      label: string
      kind: 'number'
      min?: number
      max?: number
      step?: number
      help?: string
    }
  | { key: string; label: string; kind: 'boolean'; help?: string }
  | {
      key: string
      label: string
      kind: 'select'
      options: { value: string; label: string }[]
      help?: string
    }
  | {
      key: string
      label: string
      kind: 'multiselect'
      options: { value: string; label: string }[]
      help?: string
    }

export interface CompileContext {
  refData: ReferenceData | null
}

export interface CompiledBase {
  types: EventType[]
  names?: string[]
  conditions: Condition[]
  unresolved?: string
}

export interface TriggerPreset {
  key: string
  label: string
  group:
    | 'Alert'
    | 'Lighting'
    | 'Macros'
    | 'Actions'
    | 'Power'
    | 'Ship'
    | 'Flight'
    | 'Custom'
    | 'MQTT'
    | 'UI'
    | 'System'
  description: string
  paramsSchema: z.ZodTypeAny
  fields: FieldDescriptor[]
  /** Human summary for tables */
  summarize(params: Record<string, unknown>): string
  compile(params: Record<string, unknown>, ctx: CompileContext): CompiledBase
  /** default params for a new trigger */
  defaults: Record<string, unknown>
}

const opt = (
  values: readonly string[],
  labels?: Record<string, string>
): { value: string; label: string }[] => values.map((v) => ({ value: v, label: labels?.[v] ?? v }))

function list(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String) : []
}

const presets: TriggerPreset[] = [
  // ------------------------------------------------------------------ Alert
  {
    key: 'thorium.alertLevel',
    label: 'Alert level is',
    group: 'Alert',
    description:
      'Fires when the simulator alert level changes to one of the selected levels. Training mode counts as level 5.',
    paramsSchema: z.object({
      levels: z.array(z.enum(ALERT_LEVELS)).min(1),
      includeInitial: z.boolean().default(true)
    }),
    fields: [
      {
        key: 'levels',
        label: 'Levels',
        kind: 'multiselect',
        options: opt(ALERT_LEVELS, {
          '5': '5 – Normal',
          '4': '4',
          '3': '3',
          '2': '2',
          '1': '1 – Red Alert',
          p: 'P – Pause'
        })
      },
      {
        key: 'includeInitial',
        label: 'Also fire on connect (apply current level)',
        kind: 'boolean'
      }
    ],
    defaults: { levels: ['1'], includeInitial: true },
    summarize: (p) => `Alert level → ${list(p.levels).join(', ')}`,
    compile: (p) => {
      const conds: Condition[] =
        list(p.levels).length === 1
          ? [{ path: 'level', op: 'eq', value: list(p.levels)[0] }]
          : [{ path: 'level', op: 'regex', value: `^(${list(p.levels).join('|')})$` }]
      if (p.includeInitial === false) conds.push({ path: 'initial', op: 'eq', value: false })
      return { types: ['thorium.state'], names: ['alertLevel.changed'], conditions: conds }
    }
  },
  {
    key: 'thorium.alertLevelAny',
    label: 'Alert level changes (any)',
    group: 'Alert',
    description:
      'Fires on every alert level change. Use conditions on `level` / `previous` for finer control.',
    paramsSchema: z.object({}),
    fields: [],
    defaults: {},
    summarize: () => 'Any alert level change',
    compile: () => ({ types: ['thorium.state'], names: ['alertLevel.changed'], conditions: [] })
  },
  {
    key: 'thorium.training',
    label: 'Training mode',
    group: 'Alert',
    description: 'Fires when training mode is switched on or off.',
    paramsSchema: z.object({ on: z.boolean() }),
    fields: [{ key: 'on', label: 'Training turned on', kind: 'boolean' }],
    defaults: { on: true },
    summarize: (p) => `Training ${p.on ? 'on' : 'off'}`,
    compile: (p) => ({
      types: ['thorium.state'],
      names: ['training.changed'],
      conditions: [{ path: 'training', op: 'eq', value: !!p.on }]
    })
  },
  // --------------------------------------------------------------- Lighting
  {
    key: 'thorium.lightingAction',
    label: 'Thorium lighting effect',
    group: 'Lighting',
    description:
      "Fires when the Flight Director's Lighting core or a macro sets a lighting effect (blackout, work, shake…).",
    paramsSchema: z.object({ actions: z.array(z.enum(LIGHTING_ACTIONS)).min(1) }),
    fields: [
      { key: 'actions', label: 'Effects', kind: 'multiselect', options: opt(LIGHTING_ACTIONS) }
    ],
    defaults: { actions: ['blackout'] },
    summarize: (p) => `Lighting effect → ${list(p.actions).join(', ')}`,
    compile: (p) => ({
      types: ['thorium.state'],
      names: ['lighting.actionChanged'],
      conditions: [{ path: 'action', op: 'regex', value: `^(${list(p.actions).join('|')})$` }]
    })
  },
  {
    key: 'thorium.lightingIntensity',
    label: 'Thorium lighting intensity',
    group: 'Lighting',
    description: 'Fires when the lighting intensity slider changes. Intensity is 0–1.',
    paramsSchema: z.object({ op: z.enum(['lt', 'gt', 'eq']), value: z.number().min(0).max(1) }),
    fields: [
      {
        key: 'op',
        label: 'Condition',
        kind: 'select',
        options: [
          { value: 'lt', label: 'below' },
          { value: 'gt', label: 'above' },
          { value: 'eq', label: 'equals' }
        ]
      },
      { key: 'value', label: 'Intensity (0–1)', kind: 'number', min: 0, max: 1, step: 0.05 }
    ],
    defaults: { op: 'lt', value: 0.5 },
    summarize: (p) => `Intensity ${p.op} ${p.value}`,
    compile: (p) => ({
      types: ['thorium.state'],
      names: ['lighting.intensityChanged'],
      conditions: [{ path: 'intensity', op: p.op as Condition['op'], value: Number(p.value) }]
    })
  },
  // ----------------------------------------------------------------- Macros
  {
    key: 'thorium.generic',
    label: 'Generic macro key',
    group: 'Macros',
    description:
      'Fires when a timeline item, macro or macro button runs "Generic: Do a generic thing" with a matching key. Supports * wildcards.',
    paramsSchema: z.object({ key: z.string().min(1) }),
    fields: [
      {
        key: 'key',
        label: 'Key',
        kind: 'text',
        placeholder: 'lights-hyperspace',
        help: 'Use * for wildcards, e.g. lights-*'
      }
    ],
    defaults: { key: '' },
    summarize: (p) => `Generic key "${p.key}"`,
    compile: (p) => ({
      types: ['thorium.event'],
      names: ['generic'],
      conditions: [{ path: 'key', op: 'glob', value: String(p.key ?? '') }]
    })
  },
  {
    key: 'thorium.macro',
    label: 'Macro triggered',
    group: 'Macros',
    description: 'Fires when a named macro is run (from core, a timeline item or a button).',
    paramsSchema: z.object({ macroName: z.string().min(1) }),
    fields: [{ key: 'macroName', label: 'Macro name', kind: 'text', autocomplete: 'macroName' }],
    defaults: { macroName: '' },
    summarize: (p) => `Macro "${p.macroName}"`,
    compile: (p, ctx) => {
      const m = ctx.refData?.macros.find((x) => eqIgnoreCase(x.name, String(p.macroName)))
      if (!m)
        return {
          types: ['thorium.event'],
          names: ['triggerMacroAction'],
          conditions: [{ path: 'macroId', op: 'eq', value: '__unresolved__' }],
          unresolved: `Macro "${p.macroName}" not found on the Thorium server`
        }
      return {
        types: ['thorium.event'],
        names: ['triggerMacroAction'],
        conditions: [{ path: 'macroId', op: 'eq', value: m.id }]
      }
    }
  },
  {
    key: 'thorium.macroButton',
    label: 'Macro button pressed',
    group: 'Macros',
    description: 'Fires when a macro button with the given name is pressed on core.',
    paramsSchema: z.object({ buttonName: z.string().min(1), configName: z.string().optional() }),
    fields: [
      { key: 'buttonName', label: 'Button name', kind: 'text', autocomplete: 'buttonName' },
      { key: 'configName', label: 'Button config (optional)', kind: 'text' }
    ],
    defaults: { buttonName: '', configName: '' },
    summarize: (p) => `Button "${p.buttonName}"`,
    compile: (p, ctx) => {
      const ids: string[] = []
      for (const cfg of ctx.refData?.macroButtonConfigs ?? []) {
        if (p.configName && !eqIgnoreCase(cfg.name, String(p.configName))) continue
        for (const b of cfg.buttons) if (eqIgnoreCase(b.name, String(p.buttonName))) ids.push(b.id)
      }
      if (ids.length === 0)
        return {
          types: ['thorium.event'],
          names: ['triggerMacroButton'],
          conditions: [{ path: 'buttonId', op: 'eq', value: '__unresolved__' }],
          unresolved: `Macro button "${p.buttonName}" not found`
        }
      return {
        types: ['thorium.event'],
        names: ['triggerMacroButton'],
        conditions: [{ path: 'buttonId', op: 'regex', value: `^(${ids.join('|')})$` }]
      }
    }
  },
  {
    key: 'thorium.timelineItem',
    label: 'Timeline item executed',
    group: 'Macros',
    description:
      'Fires when a timeline step of a mission is executed. Optionally narrow to one item by name.',
    paramsSchema: z.object({
      missionName: z.string().min(1),
      stepName: z.string().min(1),
      itemName: z.string().optional()
    }),
    fields: [
      { key: 'missionName', label: 'Mission', kind: 'text', autocomplete: 'missionName' },
      { key: 'stepName', label: 'Timeline step', kind: 'text' },
      { key: 'itemName', label: 'Item name (optional)', kind: 'text' }
    ],
    defaults: { missionName: '', stepName: '', itemName: '' },
    summarize: (p) =>
      `Timeline "${p.missionName}" › ${p.stepName}${p.itemName ? ' › ' + p.itemName : ''}`,
    compile: (p, ctx) => {
      const ids: string[] = []
      for (const mission of ctx.refData?.missions ?? []) {
        if (!eqIgnoreCase(mission.name, String(p.missionName))) continue
        for (const step of mission.timeline) {
          if (!eqIgnoreCase(step.name, String(p.stepName))) continue
          for (const item of step.items)
            if (!p.itemName || eqIgnoreCase(item.name, String(p.itemName))) ids.push(item.id)
        }
      }
      if (ids.length === 0)
        return {
          types: ['thorium.event'],
          names: ['triggerMacros'],
          conditions: [{ path: 'macros[].stepId', op: 'eq', value: '__unresolved__' }],
          unresolved: 'Timeline step/item not found in current missions'
        }
      return {
        types: ['thorium.event'],
        names: ['triggerMacros'],
        conditions: [{ path: 'macros[].stepId', op: 'regex', value: `^(${ids.join('|')})$` }]
      }
    }
  },
  // ---------------------------------------------------------------- Actions
  {
    key: 'thorium.action',
    label: 'Thorium action (flash, blackout…)',
    group: 'Actions',
    description:
      'Fires when the FD triggers a station action such as Flash, Spark, Blackout or Power Loss.',
    paramsSchema: z.object({ actions: z.array(z.enum(THORIUM_TRIGGER_ACTIONS)).min(1) }),
    fields: [
      {
        key: 'actions',
        label: 'Actions',
        kind: 'multiselect',
        options: opt(THORIUM_TRIGGER_ACTIONS)
      }
    ],
    defaults: { actions: ['flash'] },
    summarize: (p) => `Action → ${list(p.actions).join(', ')}`,
    compile: (p) => ({
      types: ['thorium.event'],
      names: ['triggerAction'],
      conditions: [{ path: 'action', op: 'regex', value: `^(${list(p.actions).join('|')})$` }]
    })
  },
  {
    key: 'thorium.sound',
    label: 'Sound played',
    group: 'Actions',
    description: 'Fires when Thorium plays a sound whose asset path contains the text.',
    paramsSchema: z.object({ assetContains: z.string().min(1) }),
    fields: [
      { key: 'assetContains', label: 'Asset path contains', kind: 'text', placeholder: 'explosion' }
    ],
    defaults: { assetContains: '' },
    summarize: (p) => `Sound contains "${p.assetContains}"`,
    compile: (p) => ({
      types: ['thorium.event'],
      names: ['playSound'],
      conditions: [{ path: 'sound.asset', op: 'contains', value: String(p.assetContains) }]
    })
  },
  {
    key: 'thorium.keyboardKey',
    label: 'Thorium keyboard key',
    group: 'Actions',
    description:
      'Fires when a Thorium keyboard set key is pressed on any client (the kiosk SFX keys).',
    paramsSchema: z.object({ key: z.string().min(1) }),
    fields: [{ key: 'key', label: 'Key', kind: 'text', placeholder: 'f' }],
    defaults: { key: '' },
    summarize: (p) => `Keyboard key "${p.key}"`,
    compile: (p) => ({
      types: ['thorium.event'],
      names: ['triggerKeyboardAction'],
      conditions: [{ path: 'key', op: 'eq', value: String(p.key) }]
    })
  },
  // ------------------------------------------------------------------ Power
  {
    key: 'thorium.battery',
    label: 'Battery level crosses threshold',
    group: 'Power',
    description:
      'Fires when any battery on the ship drops below or rises above a threshold configured in Thorium settings.',
    paramsSchema: z.object({
      direction: z.enum(['below', 'above']),
      threshold: z.number().min(0).max(1)
    }),
    fields: [
      {
        key: 'direction',
        label: 'Direction',
        kind: 'select',
        options: [
          { value: 'below', label: 'drops below' },
          { value: 'above', label: 'rises above' }
        ]
      },
      {
        key: 'threshold',
        label: 'Threshold (0–1)',
        kind: 'number',
        min: 0,
        max: 1,
        step: 0.05,
        help: 'Must be one of the thresholds listed on the Thorium page.'
      }
    ],
    defaults: { direction: 'below', threshold: 0.25 },
    summarize: (p) => `Battery ${p.direction} ${Math.round(Number(p.threshold) * 100)}%`,
    compile: (p) => ({
      types: ['thorium.state'],
      names: [`battery.${p.direction}`],
      conditions: [{ path: 'threshold', op: 'eq', value: Number(p.threshold) }]
    })
  },
  {
    key: 'thorium.reactor',
    label: 'Reactor state',
    group: 'Power',
    description:
      'Fires on reactor state changes: ejected/restored, external power, heat threshold.',
    paramsSchema: z.object({
      event: z.enum([
        'ejected',
        'restored',
        'externalPowerOn',
        'externalPowerOff',
        'heatAbove',
        'heatBelow'
      ])
    }),
    fields: [
      {
        key: 'event',
        label: 'Event',
        kind: 'select',
        options: opt(
          ['ejected', 'restored', 'externalPowerOn', 'externalPowerOff', 'heatAbove', 'heatBelow'],
          {
            ejected: 'Reactor ejected',
            restored: 'Reactor restored',
            externalPowerOn: 'External power on',
            externalPowerOff: 'External power off',
            heatAbove: 'Heat above threshold',
            heatBelow: 'Heat back below threshold'
          }
        )
      }
    ],
    defaults: { event: 'ejected' },
    summarize: (p) => `Reactor ${p.event}`,
    compile: (p) => ({ types: ['thorium.state'], names: [`reactor.${p.event}`], conditions: [] })
  },
  {
    key: 'thorium.powerOutput',
    label: 'Reactor power output',
    group: 'Power',
    description: 'Fires when the reactor power output changes and satisfies the condition.',
    paramsSchema: z.object({ op: z.enum(['lt', 'gt', 'eq']), value: z.number() }),
    fields: [
      {
        key: 'op',
        label: 'Condition',
        kind: 'select',
        options: [
          { value: 'lt', label: 'below' },
          { value: 'gt', label: 'above' },
          { value: 'eq', label: 'equals' }
        ]
      },
      { key: 'value', label: 'Power output', kind: 'number', min: 0, step: 1 }
    ],
    defaults: { op: 'lt', value: 50 },
    summarize: (p) => `Power output ${p.op} ${p.value}`,
    compile: (p) => ({
      types: ['thorium.state'],
      names: ['power.outputChanged'],
      conditions: [{ path: 'powerOutput', op: p.op as Condition['op'], value: Number(p.value) }]
    })
  },
  {
    key: 'thorium.systemDamage',
    label: 'System damaged / repaired',
    group: 'Power',
    description:
      'Fires when a ship system breaks or is repaired. Leave the name blank for any system.',
    paramsSchema: z.object({
      state: z.enum(['damaged', 'repaired']),
      systemName: z.string().optional()
    }),
    fields: [
      { key: 'state', label: 'State', kind: 'select', options: opt(['damaged', 'repaired']) },
      {
        key: 'systemName',
        label: 'System name (optional)',
        kind: 'text',
        autocomplete: 'systemName'
      }
    ],
    defaults: { state: 'damaged', systemName: '' },
    summarize: (p) => `${p.systemName || 'Any system'} ${p.state}`,
    compile: (p) => ({
      types: ['thorium.state'],
      names: [`system.${p.state}`],
      conditions: p.systemName
        ? [{ path: 'systemName', op: 'eq', value: String(p.systemName) }]
        : []
    })
  },
  // ------------------------------------------------------------------- Ship
  {
    key: 'thorium.shields',
    label: 'Shields raised / lowered',
    group: 'Ship',
    description: 'Fires when any shield is raised, or when all shields are down.',
    paramsSchema: z.object({ state: z.enum(['raised', 'lowered']) }),
    fields: [{ key: 'state', label: 'State', kind: 'select', options: opt(['raised', 'lowered']) }],
    defaults: { state: 'raised' },
    summarize: (p) => `Shields ${p.state}`,
    compile: (p) => ({ types: ['thorium.state'], names: [`shields.${p.state}`], conditions: [] })
  },
  {
    key: 'thorium.weapons',
    label: 'Weapons fired',
    group: 'Ship',
    description: 'Fires when phasers or a torpedo are fired.',
    paramsSchema: z.object({ which: z.enum(['phasers', 'torpedo', 'any']) }),
    fields: [
      { key: 'which', label: 'Weapon', kind: 'select', options: opt(['any', 'phasers', 'torpedo']) }
    ],
    defaults: { which: 'any' },
    summarize: (p) => `${p.which === 'any' ? 'Any weapon' : p.which} fired`,
    compile: (p) => ({
      types: ['thorium.event'],
      names:
        p.which === 'phasers'
          ? ['firePhasers']
          : p.which === 'torpedo'
            ? ['fireTorpedo']
            : ['firePhasers', 'fireTorpedo'],
      conditions: []
    })
  },
  {
    key: 'thorium.selfDestruct',
    label: 'Self destruct armed',
    group: 'Ship',
    description: 'Fires when a self-destruct countdown is set.',
    paramsSchema: z.object({}),
    fields: [],
    defaults: {},
    summarize: () => 'Self destruct armed',
    compile: () => ({
      types: ['thorium.event'],
      names: ['setSelfDestructTime'],
      conditions: [{ path: 'time', op: 'gt', value: 0 }]
    })
  },
  {
    key: 'thorium.stealth',
    label: 'Stealth field',
    group: 'Ship',
    description: 'Fires when the stealth field is activated or deactivated.',
    paramsSchema: z.object({ on: z.boolean() }),
    fields: [{ key: 'on', label: 'Activated', kind: 'boolean' }],
    defaults: { on: true },
    summarize: (p) => `Stealth ${p.on ? 'on' : 'off'}`,
    compile: (p) => ({
      types: ['thorium.state'],
      names: ['stealth.changed'],
      conditions: [{ path: 'state', op: 'eq', value: !!p.on }]
    })
  },
  // ----------------------------------------------------------------- Flight
  {
    key: 'thorium.flight',
    label: 'Flight lifecycle',
    group: 'Flight',
    description: 'Fires on flight start, pause, resume, reset or end.',
    paramsSchema: z.object({ event: z.enum(['started', 'paused', 'resumed', 'reset', 'ended']) }),
    fields: [
      {
        key: 'event',
        label: 'Event',
        kind: 'select',
        options: opt(['started', 'paused', 'resumed', 'reset', 'ended'])
      }
    ],
    defaults: { event: 'reset' },
    summarize: (p) => `Flight ${p.event}`,
    compile: (p) => ({ types: ['thorium.state'], names: [`flight.${p.event}`], conditions: [] })
  },
  {
    key: 'thorium.clientAssigned',
    label: 'This client assigned by FD',
    group: 'Flight',
    description:
      'Fires when the Flight Director assigns this lighting client to a flight/simulator.',
    paramsSchema: z.object({}),
    fields: [],
    defaults: {},
    summarize: () => 'Client assigned',
    compile: () => ({ types: ['thorium.state'], names: ['client.assigned'], conditions: [] })
  },
  // ----------------------------------------------------------------- Custom
  {
    key: 'custom.event',
    label: 'Custom Thorium event',
    group: 'Custom',
    description: 'Match any Thorium event by name. Add conditions on its arguments below.',
    paramsSchema: z.object({ eventName: z.string().min(1) }),
    fields: [
      {
        key: 'eventName',
        label: 'Event name',
        kind: 'text',
        autocomplete: 'eventName',
        placeholder: 'shieldRaised'
      }
    ],
    defaults: { eventName: '' },
    summarize: (p) => `Event "${p.eventName}"`,
    compile: (p) => ({
      types: ['thorium.event'],
      names: [String(p.eventName ?? '')],
      conditions: []
    })
  },
  {
    key: 'custom.any',
    label: 'Any Thorium event (conditions only)',
    group: 'Custom',
    description: 'Matches every Thorium event; rely entirely on conditions (e.g. event glob).',
    paramsSchema: z.object({}),
    fields: [],
    defaults: {},
    summarize: () => 'Any Thorium event',
    compile: () => ({ types: ['thorium.event'], conditions: [] })
  },
  // ------------------------------------------------------------------- MQTT
  {
    key: 'mqtt.message',
    label: 'MQTT message',
    group: 'MQTT',
    description:
      'Fires for messages on a topic (supports + and # wildcards). Add conditions on `payload` or `json.<field>`.',
    paramsSchema: z.object({ topic: z.string().min(1) }),
    fields: [{ key: 'topic', label: 'Topic filter', kind: 'text', placeholder: 'cmsc/lobby/#' }],
    defaults: { topic: '' },
    summarize: (p) => `MQTT "${p.topic}"`,
    compile: (p) => ({
      types: ['mqtt.message'],
      conditions: [
        { path: 'topicMatch', op: 'glob', value: mqttFilterToGlob(String(p.topic ?? '')) }
      ]
    })
  },
  // --------------------------------------------------------------------- UI
  {
    key: 'ui.action',
    label: 'UI action',
    group: 'UI',
    description: 'Fires when a Dashboard button is used (scene activate/release, blackout…).',
    paramsSchema: z.object({
      action: z.enum([
        'scene.activate',
        'scene.release',
        'blackout',
        'releaseAll',
        'alertOverride'
      ]),
      sceneName: z.string().optional()
    }),
    fields: [
      {
        key: 'action',
        label: 'Action',
        kind: 'select',
        options: opt(['scene.activate', 'scene.release', 'blackout', 'releaseAll', 'alertOverride'])
      },
      { key: 'sceneName', label: 'Scene name (optional)', kind: 'text' }
    ],
    defaults: { action: 'scene.activate', sceneName: '' },
    summarize: (p) => `UI ${p.action}${p.sceneName ? ' "' + p.sceneName + '"' : ''}`,
    compile: (p) => ({
      types: ['ui.action'],
      names: [String(p.action)],
      conditions: p.sceneName ? [{ path: 'sceneName', op: 'eq', value: String(p.sceneName) }] : []
    })
  },
  // ----------------------------------------------------------------- System
  {
    key: 'system.startup',
    label: 'App started',
    group: 'System',
    description: 'Fires once when the app starts (after outputs are up). Useful for a base look.',
    paramsSchema: z.object({}),
    fields: [],
    defaults: {},
    summarize: () => 'App started',
    compile: () => ({ types: ['system'], names: ['startup'], conditions: [] })
  },
  {
    key: 'system.thorium',
    label: 'Thorium connection state',
    group: 'System',
    description: 'Fires when the Thorium connection is established or lost.',
    paramsSchema: z.object({ state: z.enum(['connected', 'disconnected']) }),
    fields: [
      { key: 'state', label: 'State', kind: 'select', options: opt(['connected', 'disconnected']) }
    ],
    defaults: { state: 'disconnected' },
    summarize: (p) => `Thorium ${p.state}`,
    compile: (p) => ({ types: ['system'], names: [`thorium.${p.state}`], conditions: [] })
  }
]

/** MQTT topic filters use +/#; turn them into our glob syntax for the `topicMatch` helper field. */
function mqttFilterToGlob(filter: string): string {
  return filter.replace(/\+/g, '*').replace(/#/g, '*')
}

const byKey = new Map(presets.map((p) => [p.key, p]))

export function getPreset(key: string): TriggerPreset | undefined {
  return byKey.get(key)
}
export function listPresets(): TriggerPreset[] {
  return presets
}
export const PRESET_GROUPS: TriggerPreset['group'][] = [
  'Alert',
  'Lighting',
  'Macros',
  'Actions',
  'Power',
  'Ship',
  'Flight',
  'Custom',
  'MQTT',
  'UI',
  'System'
]

export function compileTrigger(
  presetKey: string,
  params: Record<string, unknown>,
  ctx: CompileContext
): CompiledBase {
  const preset = byKey.get(presetKey)
  if (!preset)
    return { types: [], conditions: [], unresolved: `Unknown trigger preset "${presetKey}"` }
  const parsed = preset.paramsSchema.safeParse({ ...preset.defaults, ...params })
  if (!parsed.success) {
    return {
      types: [],
      conditions: [],
      unresolved: `Invalid trigger settings: ${parsed.error.issues.map((i) => i.message).join('; ')}`
    }
  }
  return preset.compile(parsed.data as Record<string, unknown>, ctx)
}

export function summarizeTrigger(presetKey: string, params: Record<string, unknown>): string {
  const preset = byKey.get(presetKey)
  if (!preset) return presetKey
  try {
    return preset.summarize({ ...preset.defaults, ...params })
  } catch {
    return preset.label
  }
}
