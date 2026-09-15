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
  },
  {
    // v3: trigger.conditions became a list of leaves *and/or* "any of" groups.
    // A flat `Condition[]` is already a valid `ConditionNode[]`, so this is a
    // no-op widening — it exists only so the version gate stays honest.
    from: 2,
    to: 3,
    up(raw) {
      return { ...raw, schemaVersion: 3 }
    }
  },
  {
    // v4: a mapping holds a *list* of triggers, ORed together, and owns the
    // simulator restriction itself (it was per-trigger, but the editor always
    // presented it per-mapping and every trigger in a mapping must agree).
    from: 3,
    to: 4,
    up(raw) {
      const profiles = Array.isArray(raw.profiles)
        ? (raw.profiles as Record<string, unknown>[])
        : []
      for (const p of profiles) {
        const mappings = Array.isArray(p.mappings) ? (p.mappings as Record<string, unknown>[]) : []
        for (const m of mappings) {
          if (!Array.isArray(m.triggers)) m.triggers = m.trigger ? [m.trigger] : []
          const triggers = m.triggers as Record<string, unknown>[]
          if (!Array.isArray(m.simulatorNames)) {
            const owner = triggers.find((t) => Array.isArray(t?.simulatorNames))
            m.simulatorNames = owner ? owner.simulatorNames : []
          }
          for (const t of triggers) if (t) delete t.simulatorNames
          delete m.trigger
        }
      }
      return { ...raw, schemaVersion: 4 }
    }
  },
  {
    // v5: scene.reducedEffectsCleared (defaults to false). A no-op here, but the
    // bump makes an older build refuse the file instead of silently dropping
    // the flags on its next save.
    from: 4,
    to: 5,
    up(raw) {
      return { ...raw, schemaVersion: 5 }
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
