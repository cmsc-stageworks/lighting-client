import { EventEmitter } from 'events'
import { promises as fs } from 'fs'
import { join, basename } from 'path'
import os from 'os'
import {
  AppConfigSchema,
  PartialConfigSchema,
  ProfileSchema,
  validateProfileReferences,
  type AppConfig,
  type AppSettings,
  type PartialConfig,
  type Profile
} from '@shared/schema/config.schema'
import { migrateConfig } from '@shared/schema/migrations'
import { seedConfig, seedProfile } from '@shared/seed'
import { CONFIG_SCHEMA_VERSION } from '@shared/constants'
import { eqIgnoreCase, uuid } from '@shared/utils'
import { getLogger } from '../logging'

const log = getLogger('config')
const BACKUP_KEEP = 20

export interface ConfigChange {
  config: AppConfig
  /** What changed, so services can react minimally. */
  scope: 'profile' | 'settings' | 'activeProfile' | 'all'
}

export class ConfigStore extends EventEmitter {
  private config!: AppConfig
  private file: string
  private backupDir: string
  private writing: Promise<void> = Promise.resolve()
  public loadError: string | null = null

  constructor(userData: string) {
    super()
    this.file = join(userData, 'config.json')
    this.backupDir = join(userData, 'backups')
  }

  get(): AppConfig {
    return this.config
  }

  active(): Profile {
    return (
      this.config.profiles.find((p) => p.id === this.config.activeProfileId) ??
      this.config.profiles[0]
    )
  }

  settings(): AppSettings {
    return this.config.settings
  }

  async load(): Promise<void> {
    await fs.mkdir(this.backupDir, { recursive: true })
    let raw: string | null = null
    try {
      raw = await fs.readFile(this.file, 'utf8')
    } catch {
      raw = null
    }
    if (raw == null) {
      this.config = seedConfig(os.hostname())
      log.info('no config found, seeding defaults')
      await this.persist()
      return
    }
    try {
      const parsedJson = JSON.parse(raw) as Record<string, unknown>
      const { migrated, applied } = migrateConfig(parsedJson)
      const result = AppConfigSchema.safeParse(migrated)
      if (!result.success) {
        throw new Error(
          result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
        )
      }
      this.config = result.data
      if (applied.length) {
        log.info(`migrated config to version ${CONFIG_SCHEMA_VERSION}`)
        await this.persist()
      }
    } catch (err) {
      const msg = (err as Error).message
      log.error(`config invalid: ${msg}`)
      this.loadError = msg
      // Keep the broken file untouched; run on seed config in memory.
      this.config = seedConfig(os.hostname())
      try {
        await fs.copyFile(this.file, join(this.backupDir, `config-broken-${stamp()}.json`))
      } catch {
        /* ignore */
      }
    }
  }

  private lastProfilesJson = ''

  /**
   * Atomic write. A backup copy is taken only when profile content changed (not for
   * window-bounds or other silent settings patches) so the rolling backups stay useful.
   * A failed write never poisons the queue: the chain always recovers.
   */
  private async persist(): Promise<void> {
    const json = JSON.stringify(this.config, null, 2)
    const profilesJson = JSON.stringify({ p: this.config.profiles, a: this.config.activeProfileId })
    const contentChanged = profilesJson !== this.lastProfilesJson
    const run = async (): Promise<void> => {
      if (contentChanged) {
        try {
          await fs.access(this.file)
          await fs.copyFile(this.file, join(this.backupDir, `config-${stamp()}.json`))
          await this.pruneBackups()
        } catch {
          /* first write: nothing to back up */
        }
      }
      const tmp = this.file + '.tmp'
      await fs.writeFile(tmp, json, 'utf8')
      await fs.rename(tmp, this.file)
      this.lastProfilesJson = profilesJson
    }
    const next = this.writing.catch(() => undefined).then(run)
    this.writing = next.catch((err) => {
      log.error(`config write failed: ${(err as Error).message}`)
    })
    await next
  }

  private async pruneBackups(): Promise<void> {
    const files = (await fs.readdir(this.backupDir)).filter(
      (f) => f.startsWith('config-') && f.endsWith('.json') && !f.includes('broken')
    )
    files.sort()
    const excess = files.length - BACKUP_KEEP
    for (let i = 0; i < excess; i++)
      await fs.unlink(join(this.backupDir, files[i])).catch(() => undefined)
  }

  private async commit(scope: ConfigChange['scope']): Promise<void> {
    await this.persist()
    this.emit('change', { config: this.config, scope } satisfies ConfigChange)
  }

  // ------------------------------------------------------------------ mutations

  async saveProfile(profile: Profile): Promise<{ ok: true } | { ok: false; errors: string[] }> {
    const parsed = ProfileSchema.safeParse(profile)
    if (!parsed.success) return { ok: false, errors: describeIssues(profile, parsed.error.issues) }
    const refErrors = validateProfileReferences(parsed.data)
    if (refErrors.length) return { ok: false, errors: refErrors }
    const idx = this.config.profiles.findIndex((p) => p.id === parsed.data.id)
    if (idx === -1)
      return {
        ok: false,
        errors: [
          'This profile no longer exists (was the active profile switched?). Discard and reload.'
        ]
      }
    this.config.profiles[idx] = parsed.data
    try {
      await this.commit('profile')
    } catch (err) {
      return { ok: false, errors: [`Could not write config file: ${(err as Error).message}`] }
    }
    return { ok: true }
  }

  /** Internal partial update of the active profile (e.g. grand master persisted from runtime). */
  async patchActiveProfile(patch: Partial<Profile>, silent = false): Promise<void> {
    const p = this.active()
    Object.assign(p, patch)
    await this.persist()
    if (!silent)
      this.emit('change', { config: this.config, scope: 'profile' } satisfies ConfigChange)
  }

  async saveSettings(settings: AppSettings): Promise<void> {
    this.config.settings = settings
    await this.commit('settings')
  }

  async patchSettings(patch: Partial<AppSettings>, silent = false): Promise<void> {
    Object.assign(this.config.settings, patch)
    await this.persist()
    if (!silent)
      this.emit('change', { config: this.config, scope: 'settings' } satisfies ConfigChange)
  }

  async setActiveProfile(id: string): Promise<void> {
    if (!this.config.profiles.some((p) => p.id === id)) throw new Error('Profile not found')
    this.config.activeProfileId = id
    await this.commit('activeProfile')
  }

  async createProfile(name: string, kind: Profile['kind']): Promise<Profile> {
    const p = seedProfile(name, kind, os.hostname())
    if (kind === 'single-ship') p.simulators = p.simulators.slice(0, 1)
    this.config.profiles.push(p)
    await this.commit('all')
    return p
  }

  async deleteProfile(id: string): Promise<void> {
    if (this.config.profiles.length <= 1) throw new Error('Cannot delete the last profile')
    this.config.profiles = this.config.profiles.filter((p) => p.id !== id)
    if (this.config.activeProfileId === id) this.config.activeProfileId = this.config.profiles[0].id
    await this.commit('all')
  }

  // ------------------------------------------------------------------ import / export

  exportAll(): string {
    return JSON.stringify(this.config, null, 2)
  }

  exportPartial(): string {
    const p = this.active()
    const doc: PartialConfig = {
      kind: 'partial',
      schemaVersion: CONFIG_SCHEMA_VERSION,
      scenes: p.scenes,
      mappings: p.mappings,
      simulators: p.simulators,
      layers: p.layers
    }
    return JSON.stringify(doc, null, 2)
  }

  /** Parse an import document; returns a plan without applying it. */
  previewImport(text: string):
    | { kind: 'all'; config: AppConfig }
    | {
        kind: 'partial'
        partial: PartialConfig
        summary: { added: Record<string, number>; updated: Record<string, number> }
        warnings: string[]
      } {
    const raw = JSON.parse(text) as Record<string, unknown>
    if (raw.kind === 'partial') {
      const parsed = PartialConfigSchema.safeParse(raw)
      if (!parsed.success) throw new Error(parsed.error.issues.map((i) => i.message).join('; '))
      const active = this.active()
      const added: Record<string, number> = {}
      const updated: Record<string, number> = {}
      const count = (
        key: string,
        existing: { name: string }[],
        incoming: { name: string }[]
      ): void => {
        let a = 0
        let u = 0
        for (const it of incoming) existing.some((e) => eqIgnoreCase(e.name, it.name)) ? u++ : a++
        added[key] = a
        updated[key] = u
      }
      count('scenes', active.scenes, parsed.data.scenes)
      count('mappings', active.mappings, parsed.data.mappings)
      count('simulators', active.simulators, parsed.data.simulators)
      count('layers', active.layers, parsed.data.layers)
      const warnings: string[] = []
      if (
        parsed.data.layers.some(
          (l) => !active.layers.some((e) => e.id === l.id || eqIgnoreCase(e.name, l.name))
        )
      )
        warnings.push(
          'New layers will be added; scenes referencing them by id will be relinked by name where possible.'
        )
      return { kind: 'partial', partial: parsed.data, summary: { added, updated }, warnings }
    }
    const { migrated } = migrateConfig(raw)
    const parsed = AppConfigSchema.safeParse(migrated)
    if (!parsed.success)
      throw new Error(
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
      )
    return { kind: 'all', config: parsed.data }
  }

  async applyImportAll(config: AppConfig): Promise<void> {
    this.config = config
    await this.commit('all')
  }

  async applyImportPartial(partial: PartialConfig): Promise<string[]> {
    const active = this.active()
    const errors: string[] = []
    // Layers: merge by name; remap incoming layer ids → existing ids
    const layerIdMap = new Map<string, string>()
    for (const l of partial.layers) {
      const existing = active.layers.find((e) => e.id === l.id || eqIgnoreCase(e.name, l.name))
      if (existing) {
        layerIdMap.set(l.id, existing.id)
        existing.priority = l.priority
      } else {
        const nl = { ...l, id: active.layers.some((e) => e.id === l.id) ? uuid() : l.id }
        active.layers.push(nl)
        layerIdMap.set(l.id, nl.id)
      }
    }
    const mapLayer = (id: string): string => layerIdMap.get(id) ?? id
    // Simulators: merge by name
    for (const s of partial.simulators) {
      const existing = active.simulators.find((e) => eqIgnoreCase(e.name, s.name))
      if (existing) Object.assign(existing, { ...s, id: existing.id })
      else
        active.simulators.push({
          ...s,
          id: active.simulators.some((e) => e.id === s.id) ? uuid() : s.id
        })
    }
    // Scenes: merge by name; remap ids for mappings
    const sceneIdMap = new Map<string, string>()
    for (const s of partial.scenes) {
      const existing = active.scenes.find((e) => eqIgnoreCase(e.name, s.name))
      if (existing) {
        Object.assign(existing, {
          ...s,
          id: existing.id,
          defaultLayerId: mapLayer(s.defaultLayerId)
        })
        sceneIdMap.set(s.id, existing.id)
      } else {
        const ns = {
          ...s,
          id: active.scenes.some((e) => e.id === s.id) ? uuid() : s.id,
          defaultLayerId: mapLayer(s.defaultLayerId)
        }
        active.scenes.push(ns)
        sceneIdMap.set(s.id, ns.id)
      }
    }
    const mapScene = (id: string): string => sceneIdMap.get(id) ?? id
    for (const m of partial.mappings) {
      const actions = m.actions.map((a) => {
        if (a.kind === 'activateScene')
          return {
            ...a,
            sceneId: mapScene(a.sceneId),
            layerId: a.layerId ? mapLayer(a.layerId) : null
          }
        if (a.kind === 'releaseScene') return { ...a, sceneId: mapScene(a.sceneId) }
        if (a.kind === 'releaseLayer') return { ...a, layerId: mapLayer(a.layerId) }
        return a
      })
      const existing = active.mappings.find((e) => eqIgnoreCase(e.name, m.name))
      if (existing) Object.assign(existing, { ...m, id: existing.id, actions })
      else
        active.mappings.push({
          ...m,
          id: active.mappings.some((e) => e.id === m.id) ? uuid() : m.id,
          actions
        })
    }
    const refErrors = validateProfileReferences(active)
    if (refErrors.length) errors.push(...refErrors)
    await this.commit('profile')
    return errors
  }

  // ------------------------------------------------------------------ backups

  async listBackups(): Promise<{ path: string; ts: number; size: number }[]> {
    const files = await fs.readdir(this.backupDir).catch(() => [] as string[])
    const out: { path: string; ts: number; size: number }[] = []
    for (const f of files) {
      if (!f.endsWith('.json')) continue
      const p = join(this.backupDir, f)
      const st = await fs.stat(p).catch(() => null)
      if (st) out.push({ path: p, ts: st.mtimeMs, size: st.size })
    }
    return out.sort((a, b) => b.ts - a.ts)
  }

  async restoreBackup(path: string): Promise<string[]> {
    if (basename(path) !== path && !path.startsWith(this.backupDir))
      throw new Error('Invalid backup path')
    const text = await fs.readFile(path, 'utf8')
    const preview = this.previewImport(text)
    if (preview.kind !== 'all') throw new Error('Backup is not a full config')
    await this.applyImportAll(preview.config)
    this.loadError = null
    return []
  }

  get filePath(): string {
    return this.file
  }
}

/** Turn zod issues like `scenes.2.name: Too small` into `Scene "Flash": name is required`. */
function describeIssues(
  profile: unknown,
  issues: { path: PropertyKey[]; message: string }[]
): string[] {
  const p = (profile ?? {}) as Record<string, unknown>
  const collections: Record<string, string> = {
    scenes: 'Scene',
    mappings: 'Mapping',
    outputs: 'Output',
    simulators: 'Simulator',
    layers: 'Layer'
  }
  const seen = new Set<string>()
  const out: string[] = []
  for (const issue of issues) {
    const [head, idx, ...rest] = issue.path.map(String)
    let label = head
    if (head in collections && idx !== undefined) {
      const arr = p[head]
      const item = Array.isArray(arr)
        ? (arr[Number(idx)] as { name?: string } | undefined)
        : undefined
      label = `${collections[head]} "${item?.name || `#${Number(idx) + 1}`}"`
    } else if (idx !== undefined) {
      label = `${head}.${idx}`
    }
    const field = rest.join('.')
    const msg = issue.message
      .replace(/^Too small: expected string to have >=1 characters?$/i, 'is required')
      .replace(/^Invalid input.*$/i, 'has an invalid value')
    const text = `${label}${field ? ': ' + field : ''} ${msg}`
    if (!seen.has(text)) {
      seen.add(text)
      out.push(text)
    }
  }
  return out
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
}
