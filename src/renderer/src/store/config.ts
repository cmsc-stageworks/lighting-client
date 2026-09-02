import { create } from 'zustand'
import type { AppConfig, AppSettings, Profile } from '@shared/types/config'
import { invoke, on } from '../lib/api'
import { toast } from './toasts'

interface ConfigStore {
  config: AppConfig | null
  /** Editable copy of the active profile. */
  draft: Profile | null
  dirty: boolean
  saving: boolean
  errors: string[]
  init: () => Promise<void>
  /** Mutate the draft immutably. */
  update: (fn: (draft: Profile) => Profile) => void
  save: () => Promise<boolean>
  discard: () => void
  saveSettings: (settings: AppSettings) => Promise<void>
  patchSettings: (patch: Partial<AppSettings>) => Promise<void>
}

export const useConfig = create<ConfigStore>((set, get) => ({
  config: null,
  draft: null,
  dirty: false,
  saving: false,
  errors: [],
  init: async () => {
    const config = await invoke('config.get')
    set({ config, draft: activeOf(config), dirty: false })
    on('config:changed', (cfg) => {
      const { dirty } = get()
      set({ config: cfg, draft: dirty ? get().draft : activeOf(cfg) })
    })
  },
  update: (fn) => {
    const d = get().draft
    if (!d) return
    set({ draft: fn(d), dirty: true, errors: [] })
  },
  save: async () => {
    const d = get().draft
    if (!d) return false
    set({ saving: true })
    try {
      const r = await invoke('config.saveProfile', d)
      if (r.ok) {
        set({ saving: false, dirty: false, errors: [] })
        return true
      }
      set({
        saving: false,
        errors: r.errors.length ? r.errors : ['Save failed for an unknown reason']
      })
      return false
    } catch (err) {
      // IPC threw (main process error). Keep the draft so nothing is lost, show why.
      set({ saving: false, errors: [`Save failed: ${(err as Error).message}`] })
      return false
    }
  },
  discard: () => {
    const c = get().config
    if (c) set({ draft: activeOf(c), dirty: false, errors: [] })
  },
  saveSettings: async (settings) => {
    try {
      await invoke('config.saveSettings', settings)
    } catch (err) {
      toast('error', `Settings not saved: ${(err as Error).message}`)
    }
  },
  patchSettings: async (patch) => {
    const c = get().config
    if (!c) return
    try {
      await invoke('config.saveSettings', { ...c.settings, ...patch })
    } catch (err) {
      toast('error', `Settings not saved: ${(err as Error).message}`)
    }
  }
}))

function activeOf(config: AppConfig): Profile {
  return config.profiles.find((p) => p.id === config.activeProfileId) ?? config.profiles[0]
}

export const selectActive = (s: ConfigStore): Profile | null => s.draft
export const selectSettings = (s: ConfigStore): AppSettings | null => s.config?.settings ?? null
