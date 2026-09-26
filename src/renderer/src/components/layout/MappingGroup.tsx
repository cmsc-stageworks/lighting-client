import React from 'react'
import clsx from 'clsx'
import { Layers3 } from 'lucide-react'
import { useRuntime } from '../../store/runtime'
import { invoke } from '../../lib/api'
import { toast } from '../../store/toasts'
import { Tooltip } from '../ui'

/**
 * Pick the active mapping group. Hidden until the (saved) profile has groups.
 * Switching takes effect immediately: the new group's alert look is applied
 * for every simulator in scope.
 */
export function MappingGroupControl(): React.JSX.Element | null {
  const mg = useRuntime((s) => s.snapshot?.mappingGroup)
  if (!mg || mg.groups.length === 0) return null
  return (
    <div
      role="radiogroup"
      aria-label="Mapping group"
      className="shrink-0 inline-flex items-center gap-0.5 p-0.5 rounded-full border border-border bg-surface-2"
    >
      <Tooltip content="Mapping group — which set of mappings is live" side="bottom">
        <span className="px-1.5 text-muted inline-flex">
          <Layers3 size={13} />
        </span>
      </Tooltip>
      {mg.groups.map((g) => {
        const active = g.id === mg.activeId
        return (
          <button
            key={g.id}
            role="radio"
            aria-checked={active}
            onClick={() =>
              !active &&
              void invoke('mappingGroup.set', g.id).catch((err: Error) =>
                toast('error', `Could not switch group: ${err.message}`)
              )
            }
            className={clsx(
              'h-7 px-2.5 rounded-full border text-[12px] font-semibold inline-flex items-center gap-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
              active
                ? 'bg-accent/20 text-text border-accent/40'
                : 'border-transparent text-muted hover:text-text hover:bg-surface-3'
            )}
          >
            <span className="size-2 rounded-full" style={{ background: g.color }} />
            {g.name}
          </button>
        )
      })}
    </div>
  )
}
