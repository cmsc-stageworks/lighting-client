import { create } from 'zustand'
import type { AppEvent, MqttMessageRecord } from '@shared/types/events'
import { invoke, on } from '../lib/api'

interface EventsStore {
  events: AppEvent[]
  mqttMessages: MqttMessageRecord[]
  paused: boolean
  capacity: number
  init: () => Promise<void>
  setPaused: (p: boolean) => void
  clear: () => Promise<void>
}

export const useEvents = create<EventsStore>((set, get) => ({
  events: [],
  mqttMessages: [],
  paused: false,
  capacity: 2000,
  init: async () => {
    const [events, mqttMessages] = await Promise.all([
      invoke('events.getRecent', 500),
      invoke('mqtt.getRecentMessages', 200)
    ])
    set({ events, mqttMessages })
    on('events:batch', (batch) => {
      if (get().paused) return
      const cap = get().capacity
      const next = get().events.concat(batch)
      set({ events: next.length > cap ? next.slice(next.length - cap) : next })
    })
    on('mqtt:message', (m) => {
      const next = get().mqttMessages.concat(m)
      set({ mqttMessages: next.length > 500 ? next.slice(next.length - 500) : next })
    })
  },
  setPaused: (paused) => set({ paused }),
  clear: async () => {
    await invoke('events.clear')
    set({ events: [] })
  }
}))
