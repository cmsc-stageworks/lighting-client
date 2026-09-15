import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { seedConfig } from '@shared/seed'
import { CONFIG_SCHEMA_VERSION } from '@shared/constants'

vi.mock('../logging', () => ({
  getLogger: () => ({
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined
  })
}))

import { ConfigStore } from './store'

/** Shape a freshly seeded (current-version) config back into a v2 document on disk. */
function asV2(config: unknown): Record<string, unknown> {
  const raw = structuredClone(config) as Record<string, unknown>
  raw.schemaVersion = 2
  for (const p of raw.profiles as { mappings: Record<string, unknown>[] }[]) {
    for (const m of p.mappings) {
      const triggers = m.triggers as Record<string, unknown>[]
      m.trigger = { ...triggers[0], simulatorNames: m.simulatorNames }
      delete m.triggers
      delete m.simulatorNames
    }
  }
  return raw
}

describe('ConfigStore', () => {
  let dir: string
  let store: ConfigStore
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cmsc-store-'))
    store = new ConfigStore(dir)
    await store.load()
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('seeds and persists a config on first load', async () => {
    const raw = JSON.parse(await readFile(join(dir, 'config.json'), 'utf8'))
    expect(raw.schemaVersion).toBe(CONFIG_SCHEMA_VERSION)
    expect(store.active().mappings.length).toBeGreaterThan(0)
    // No site-specific assumptions: simulators are configured in the wizard.
    expect(store.active().simulators).toEqual([])
  })

  it('loads and upgrades an existing v2 config in place, backing up the original', async () => {
    const dir2 = await mkdtemp(join(tmpdir(), 'cmsc-store-v2-'))
    // A believable v2 document: schemaVersion 2, one `trigger` per mapping with the
    // simulator restriction on it, and flat leaf conditions.
    const v2 = asV2(seedConfig('old-host'))
    const prof = (v2.profiles as { mappings: Record<string, never>[] }[])[0]
    const t = prof.mappings[0].trigger as unknown as Record<string, unknown>
    t.conditions = [{ path: 'level', op: 'eq', value: '5' }]
    t.simulatorNames = ['Magellan']
    await writeFile(join(dir2, 'config.json'), JSON.stringify(v2, null, 2), 'utf8')

    const s2 = new ConfigStore(dir2)
    await s2.load()
    expect(s2.loadError).toBeNull()

    // File is rewritten at the new version…
    const onDisk = JSON.parse(await readFile(join(dir2, 'config.json'), 'utf8'))
    expect(onDisk.schemaVersion).toBe(CONFIG_SCHEMA_VERSION)
    // …the single trigger became a one-entry OR list, keeping its conditions…
    const upgraded = s2.active().mappings[0]
    expect(upgraded.triggers).toHaveLength(1)
    expect(upgraded.triggers[0].conditions).toEqual([{ path: 'level', op: 'eq', value: '5' }])
    // …and the simulator restriction moved up to the mapping.
    expect(upgraded.simulatorNames).toEqual(['Magellan'])
    // An untouched, distinctly-named pre-upgrade copy was kept.
    const backups = await readdir(join(dir2, 'backups'))
    const preUpgrade = backups.find((f) => f.includes('preupgrade-v2'))
    expect(preUpgrade).toBeDefined()
    const kept = JSON.parse(await readFile(join(dir2, 'backups', preUpgrade!), 'utf8'))
    expect(kept.schemaVersion).toBe(2)
    expect(kept.profiles[0].mappings[0].trigger.conditions).toEqual([
      { path: 'level', op: 'eq', value: '5' }
    ])
    await rm(dir2, { recursive: true, force: true })
  })

  it('keeps pre-upgrade backups even when rolling backups are pruned', async () => {
    const dir3 = await mkdtemp(join(tmpdir(), 'cmsc-store-prune-'))
    await writeFile(join(dir3, 'config.json'), JSON.stringify(asV2(seedConfig('old-host'))), 'utf8')
    const s3 = new ConfigStore(dir3)
    await s3.load()
    // Force well past BACKUP_KEEP rolling backups.
    for (let i = 0; i < 25; i++) {
      const p = structuredClone(s3.active())
      p.name = `n${i}`
      await s3.saveProfile(p)
    }
    const files = await readdir(join(dir3, 'backups'))
    expect(files.some((f) => f.includes('preupgrade-v2'))).toBe(true)
    // Rolling backups are capped; the pre-upgrade copy is not counted against that cap.
    const rolling = files.filter((f) => f.startsWith('config-') && !f.includes('preupgrade'))
    expect(rolling.length).toBeLessThanOrEqual(20)
    await rm(dir3, { recursive: true, force: true })
  })

  it('rejects an invalid profile with readable errors instead of throwing', async () => {
    const p = structuredClone(store.active())
    p.scenes[0].name = ''
    p.mappings[0].simulatorNames = ['']
    const r = await store.saveProfile(p)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.errors.some((e) => /^Scene "#1": name/.test(e))).toBe(true)
      expect(r.errors.some((e) => /^Mapping "Alert level 5 → Normal"/.test(e))).toBe(true)
    }
    // Store content is untouched after a failed save
    expect(store.active().scenes[0].name).not.toBe('')
  })

  it('rejects dangling references', async () => {
    const p = structuredClone(store.active())
    p.mappings[0].actions = [
      {
        kind: 'activateScene',
        sceneId: 'missing',
        target: 'event',
        layerId: null,
        holdMsOverride: null
      }
    ]
    const r = await store.saveProfile(p)
    expect(r).toEqual({ ok: false, errors: [expect.stringMatching(/missing scene/)] })
  })

  it('saves a valid profile, emits change and writes exactly one backup per content change', async () => {
    const changes: string[] = []
    store.on('change', (c: { scope: string }) => changes.push(c.scope))
    const p = structuredClone(store.active())
    p.name = 'Renamed'
    expect(await store.saveProfile(p)).toEqual({ ok: true })
    expect(changes).toEqual(['profile'])
    expect(store.active().name).toBe('Renamed')
    // silent settings patches (window bounds) must not create backups
    await store.patchSettings({ window: { width: 1, height: 1 } }, true)
    await store.patchSettings({ window: { width: 2, height: 2 } }, true)
    const backups = (await readdir(join(dir, 'backups'))).filter((f) => f.startsWith('config-'))
    expect(backups.length).toBe(1)
  })

  it('survives a failed write and keeps working afterwards', async () => {
    // Make the config path unwritable by turning the target into a directory.
    const badStore = new ConfigStore(dir)
    await badStore.load()
    await rm(join(dir, 'config.json'))
    const { mkdir } = await import('fs/promises')
    await mkdir(join(dir, 'config.json'))
    const p = structuredClone(badStore.active())
    p.name = 'x'
    const r = await badStore.saveProfile(p)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0]).toMatch(/Could not write config file/)
    await rm(join(dir, 'config.json'), { recursive: true })
    const r2 = await badStore.saveProfile(p)
    expect(r2.ok).toBe(true)
  })
})
