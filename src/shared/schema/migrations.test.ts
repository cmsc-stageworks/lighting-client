import { describe, expect, it } from 'vitest'
import { AppConfigSchema, ProfileSchema, validateProfileReferences } from './config.schema'
import { migrateConfig } from './migrations'
import { seedConfig } from '../seed'
import { CONFIG_SCHEMA_VERSION } from '../constants'

describe('config schema + migrations', () => {
  it('seed config validates', () => {
    const cfg = seedConfig('test-host')
    const r = AppConfigSchema.safeParse(cfg)
    expect(r.success).toBe(true)
    expect(validateProfileReferences(cfg.profiles[0])).toEqual([])
  })
  it('migrates a version-less document', () => {
    const { migrated, applied } = migrateConfig({ settings: {} })
    expect(migrated.schemaVersion).toBe(CONFIG_SCHEMA_VERSION)
    expect(applied).toEqual([1, 2])
  })
  it('migrates v1 mappings to simulatorNames + category', () => {
    const v1 = {
      schemaVersion: 1,
      profiles: [
        {
          mappings: [
            { name: 'a', trigger: { preset: 'x', simulatorName: 'Magellan' } },
            { name: 'b', trigger: { preset: 'x', simulatorName: null }, category: 'Keep' }
          ]
        }
      ]
    }
    const { migrated } = migrateConfig(v1)
    const ms = (migrated.profiles as { mappings: Record<string, unknown>[] }[])[0].mappings
    expect(ms[0].trigger).toEqual({ preset: 'x', simulatorNames: ['Magellan'] })
    expect(ms[0].category).toBe('General')
    expect(ms[1].trigger).toEqual({ preset: 'x', simulatorNames: [] })
    expect(ms[1].category).toBe('Keep')
  })
  it('rejects newer versions', () => {
    expect(() => migrateConfig({ schemaVersion: 999 })).toThrow(/newer/)
  })
  it('applies defaults to a minimal profile', () => {
    const r = ProfileSchema.safeParse({
      id: 'p',
      name: 'x',
      thorium: { clientId: 'c' },
      mqtt: { clientId: 'm' }
    })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.thorium.port).toBe(4444)
      expect(r.data.mqtt.publish.baseTopic).toContain('{instanceName}')
      expect(r.data.grandMaster).toBe(1)
    }
  })
  it('reports dangling references and duplicates', () => {
    const cfg = seedConfig('h')
    const p = cfg.profiles[0]
    p.scenes[0].defaultLayerId = 'missing'
    p.mappings[0].actions = [
      {
        kind: 'activateScene',
        sceneId: 'nope',
        target: 'event',
        layerId: null,
        holdMsOverride: null
      }
    ]
    p.scenes[1].name = p.scenes[0].name
    const errors = validateProfileReferences(p)
    expect(errors.some((e) => /missing layer/.test(e))).toBe(true)
    expect(errors.some((e) => /missing scene/.test(e))).toBe(true)
    expect(errors.some((e) => /Duplicate scene/.test(e))).toBe(true)
  })
})
