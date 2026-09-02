import { create } from 'zustand'
import type { ReferenceData, RuntimeSnapshot } from '@shared/types/state'
import { THORIUM_EVENT_NAMES } from '@shared/thoriumEventNames'
import { invoke, on } from '../lib/api'

interface RuntimeStore {
  snapshot: RuntimeSnapshot | null
  refData: ReferenceData
  ready: boolean
  init: () => Promise<void>
  refreshRefData: () => Promise<void>
}

const emptyRef: ReferenceData = {
  fetchedAt: null,
  macros: [],
  macroButtonConfigs: [],
  missions: [],
  simulators: [],
  seenEventNames: [],
  knownEventNames: THORIUM_EVENT_NAMES
}

export const useRuntime = create<RuntimeStore>((set) => ({
  snapshot: null,
  refData: emptyRef,
  ready: false,
  init: async () => {
    const [snapshot, refData] = await Promise.all([
      invoke('runtime.getSnapshot'),
      invoke('thorium.getReferenceData')
    ])
    set({ snapshot, refData, ready: true })
    on('state:snapshot', (snap) => set({ snapshot: snap }))
    on('refdata:changed', (r) => set({ refData: r }))
  },
  refreshRefData: async () => {
    const refData = await invoke('thorium.refreshReferenceData')
    set({ refData })
  }
}))

export const selectThorium = (s: RuntimeStore): RuntimeSnapshot['thorium'] | null =>
  s.snapshot?.thorium ?? null
export const selectMqtt = (s: RuntimeStore): RuntimeSnapshot['mqtt'] | null =>
  s.snapshot?.mqtt ?? null
export const selectOutputs = (s: RuntimeStore): RuntimeSnapshot['outputs'] =>
  s.snapshot?.outputs ?? {}
export const selectCompositor = (s: RuntimeStore): RuntimeSnapshot['compositor'] | null =>
  s.snapshot?.compositor ?? null
