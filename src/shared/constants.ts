export const CONFIG_SCHEMA_VERSION = 2

export const DMX_CHANNELS = 512
export const DMX_MAX_VALUE = 255
export const SACN_MAX_UNIVERSE = 63999

export const DEFAULT_FPS = 40
export const MAX_FPS = 44
export const DEFAULT_SACN_KEEPALIVE_MS = 800
export const DEFAULT_SACN_PRIORITY = 100

export const THORIUM_DEFAULT_PORT = 4444
export const THORIUM_DEV_PORT = 3001

export const EVENT_LOG_DEFAULT_SIZE = 2000
export const MQTT_RECENT_MESSAGES = 500

export const ALERT_LEVELS = ['5', '4', '3', '2', '1', 'p'] as const
export type AlertLevel = (typeof ALERT_LEVELS)[number]

export const ALERT_LEVEL_LABELS: Record<AlertLevel, string> = {
  '5': 'Level 5 – Normal',
  '4': 'Level 4',
  '3': 'Level 3',
  '2': 'Level 2',
  '1': 'Level 1 – Red Alert',
  p: 'Level P – Pause'
}

export const ALERT_LEVEL_COLORS: Record<AlertLevel, string> = {
  '5': '#3ddc97',
  '4': '#8ab4f8',
  '3': '#ffe066',
  '2': '#ffb454',
  '1': '#ff5d5d',
  p: '#a78bfa'
}

export const LIGHTING_ACTIONS = [
  'normal',
  'darken',
  'blackout',
  'work',
  'fade',
  'shake',
  'strobe',
  'oscillate'
] as const

export const THORIUM_TRIGGER_ACTIONS = [
  'flash',
  'spark',
  'sound',
  'movie',
  'beep',
  'speak',
  'message',
  'blackout',
  'online',
  'offline',
  'power',
  'lockdown',
  'maintenance',
  'soviet',
  'crack',
  'uncrack',
  'reload'
] as const

/** Well-known layer ids so seeds, UI and the compositor can refer to them without lookups. */
export const LAYER_IDS = {
  base: 'layer-base',
  alert: 'layer-alert',
  scene: 'layer-scene',
  effect: 'layer-effect',
  manual: 'layer-manual',
  test: 'layer-test',
  blackout: 'layer-blackout'
} as const
