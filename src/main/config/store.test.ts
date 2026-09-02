import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, readdir, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

vi.mock('../logging', () => ({
  getLogger: () => ({
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined
  })
}))

import { ConfigStore } from './store'

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
    expect(raw.schemaVersion).toBe(2)
    expect(store.active().mappings.length).toBeGreaterThan(0)
    // No site-specific assumptions: simulators are configured in the wizard.
    expect(store.active().simulators).toEqual([])
  })

  it('rejects an invalid profile with readable errors instead of throwing', async () => {
    const p = structuredClone(store.active())
    p.scenes[0].name = ''
    p.mappings[0].trigger.simulatorNames = ['']
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
