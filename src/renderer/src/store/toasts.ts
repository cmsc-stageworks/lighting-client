import { create } from 'zustand'
import { on } from '../lib/api'

export interface Toast {
  id: number
  level: 'info' | 'warn' | 'error' | 'success'
  message: string
  /** Optional undo callback; shown as a button for 10 s. */
  undo?: () => void
  ttl: number
}

interface ToastStore {
  toasts: Toast[]
  init: () => void
  push: (t: Omit<Toast, 'id' | 'ttl'> & { ttl?: number }) => number
  dismiss: (id: number) => void
}

let seq = 0

export const useToasts = create<ToastStore>((set, get) => ({
  toasts: [],
  init: () => {
    on('toast', (t) => get().push({ level: t.level, message: t.message }))
  },
  push: (t) => {
    const id = ++seq
    const ttl = t.ttl ?? (t.undo ? 10000 : t.level === 'error' ? 8000 : 4000)
    const toast: Toast = { id, level: t.level, message: t.message, undo: t.undo, ttl }
    set({ toasts: [...get().toasts.slice(-4), toast] })
    setTimeout(() => get().dismiss(id), ttl)
    return id
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((x) => x.id !== id) })
}))

export function toast(level: Toast['level'], message: string, undo?: () => void): void {
  useToasts.getState().push({ level, message, undo })
}
