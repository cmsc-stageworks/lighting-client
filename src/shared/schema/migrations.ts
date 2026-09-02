import { CONFIG_SCHEMA_VERSION } from '../constants'

export interface Migration {
  from: number
  to: number
  up(raw: Record<string, unknown>): Record<string, unknown>
}

/**
 * Ordered migrations. Version 0 means "no schemaVersion field" (pre-release files).
 * Add a new entry whenever CONFIG_SCHEMA_VERSION is bumped.
 */
export const migrations: Migration[] = [
  {
    from: 0,
    to: 1,
    up(raw) {
      return { ...raw, schemaVersion: 1 }
    }
  },
  {
    // v2: mapping.trigger.simulatorName (string|null) → simulatorNames (string[]); mapping.category added.
    from: 1,
    to: 2,
    up(raw) {
      const profiles = Array.isArray(raw.profiles)
        ? (raw.profiles as Record<string, unknown>[])
        : []
      for (const p of profiles) {
        const mappings = Array.isArray(p.mappings) ? (p.mappings as Record<string, unknown>[]) : []
        for (const m of mappings) {
          const t = (m.trigger ?? {}) as Record<string, unknown>
          if (!Array.isArray(t.simulatorNames)) {
            const single =
              typeof t.simulatorName === 'string' && t.simulatorName ? [t.simulatorName] : []
            t.simulatorNames = single
          }
          delete t.simulatorName
          m.trigger = t
          if (typeof m.category !== 'string') m.category = 'General'
        }
      }
      return { ...raw, schemaVersion: 2 }
    }
  }
]

export function migrateConfig(raw: Record<string, unknown>): {
  migrated: Record<string, unknown>
  applied: number[]
} {
  let current = raw
  const applied: number[] = []
  let version = typeof raw.schemaVersion === 'number' ? (raw.schemaVersion as number) : 0
  while (version < CONFIG_SCHEMA_VERSION) {
    const m = migrations.find((x) => x.from === version)
    if (!m) throw new Error(`No migration from config schema version ${version}`)
    current = m.up(current)
    version = m.to
    applied.push(m.to)
  }
  if (version > CONFIG_SCHEMA_VERSION) {
    throw new Error(
      `Config schema version ${version} is newer than this app supports (${CONFIG_SCHEMA_VERSION}). Update the app.`
    )
  }
  return { migrated: current, applied }
}
