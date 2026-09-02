import React from 'react'
import clsx from 'clsx'
import { NavLink } from 'react-router-dom'
import {
  Cable,
  Clapperboard,
  GitBranch,
  Layers,
  LayoutDashboard,
  Lock,
  Radio,
  Rocket,
  Settings,
  Ship
} from 'lucide-react'
import { useConfig } from '../../store/config'

const mainNav = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/scenes', label: 'Scenes', icon: Clapperboard },
  { to: '/mappings', label: 'Mappings', icon: GitBranch }
]
const setupNav = [
  { to: '/setup/thorium', label: 'Thorium', icon: Rocket },
  { to: '/setup/mqtt', label: 'MQTT', icon: Radio },
  { to: '/setup/outputs', label: 'Outputs', icon: Cable },
  { to: '/setup/simulators', label: 'Simulators', icon: Ship },
  { to: '/setup/layers', label: 'Layers', icon: Layers },
  { to: '/setup/settings', label: 'Settings', icon: Settings }
]

export function Sidebar({ locked }: { locked: boolean }): React.JSX.Element {
  const dirty = useConfig((s) => s.dirty)
  const profile = useConfig((s) => s.draft)
  const item = (n: {
    to: string
    label: string
    icon: React.ComponentType<{ size?: number }>
    end?: boolean
  }): React.JSX.Element => (
    <NavLink
      key={n.to}
      to={n.to}
      end={n.end}
      className={({ isActive }) =>
        clsx(
          'flex items-center gap-3 h-10 px-3 rounded-[10px] text-[14px] font-medium transition-colors',
          isActive ? 'bg-accent/15 text-accent' : 'text-muted hover:text-text hover:bg-surface-2'
        )
      }
    >
      <n.icon size={18} />
      <span className="grow">{n.label}</span>
    </NavLink>
  )
  return (
    <aside className="w-[220px] shrink-0 border-r border-border bg-surface flex flex-col">
      <div className="px-4 pt-4 pb-3">
        <div className="text-[11px] font-bold tracking-[0.18em] text-faint uppercase">CMSC</div>
        <div className="font-semibold text-[15px] leading-tight">Lighting Client</div>
      </div>
      <nav className="px-2.5 flex flex-col gap-0.5">{mainNav.map(item)}</nav>
      <div className="px-4 mt-5 mb-1.5 flex items-center gap-2">
        <span className="text-[11px] font-bold tracking-[0.14em] text-faint uppercase">Setup</span>
        {locked && <Lock size={12} className="text-faint" />}
        {dirty && <span className="ml-auto text-[11px] text-warning font-semibold">Unsaved</span>}
      </div>
      <nav className="px-2.5 flex flex-col gap-0.5">{setupNav.map(item)}</nav>
      <div className="mt-auto px-4 py-3 text-[12px] text-faint border-t border-border">
        <div className="truncate">
          Profile: <span className="text-muted">{profile?.name ?? '—'}</span>
        </div>
      </div>
    </aside>
  )
}
