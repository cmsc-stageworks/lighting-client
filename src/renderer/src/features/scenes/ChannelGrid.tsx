import React, { useCallback, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { DMX_CHANNELS } from '@shared/constants'

export interface ChannelGridProps {
  /** 512 values (index 0 = channel 1) */
  values: number[]
  /** channels the scene explicitly sets (editor mode) */
  setMask?: boolean[]
  /** owner labels for monitor mode */
  owners?: (string | null)[]
  selected?: Set<number>
  onSelect?: (channels: Set<number>) => void
  /** relative mode shows offsets starting at 0 */
  labelOffset?: number
  highlightRange?: { from: number; to: number; color: string; label: string }[]
  readOnly?: boolean
  compact?: boolean
}

/**
 * 512-cell grid. Editor mode: click selects, shift-click extends, drag paints selection.
 * Monitor mode: cells flash on change and show owner in the title.
 */
export function ChannelGrid({
  values,
  setMask,
  owners,
  selected,
  onSelect,
  labelOffset = 1,
  highlightRange,
  readOnly,
  compact
}: ChannelGridProps): React.JSX.Element {
  const prev = useRef<number[]>(values)
  const [flash, setFlash] = useState<Set<number>>(new Set())
  const dragging = useRef<{ start: number; additive: boolean } | null>(null)
  const anchor = useRef<number | null>(null)

  useEffect(() => {
    if (!owners) return
    const changed = new Set<number>()
    for (let i = 0; i < DMX_CHANNELS; i++) if (prev.current[i] !== values[i]) changed.add(i)
    prev.current = values
    if (changed.size) {
      // Transient highlight driven by incoming frames; intentionally set in an effect.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFlash(changed)
      const t = setTimeout(() => setFlash(new Set()), 600)
      return () => clearTimeout(t)
    }
    return
  }, [values, owners])

  const select = useCallback(
    (i: number, e: React.MouseEvent) => {
      if (readOnly || !onSelect) return
      const next = new Set(e.ctrlKey || e.metaKey ? (selected ?? []) : [])
      if (e.shiftKey && anchor.current != null) {
        const [a, b] = [Math.min(anchor.current, i), Math.max(anchor.current, i)]
        for (let k = a; k <= b; k++) next.add(k)
      } else {
        if ((e.ctrlKey || e.metaKey) && next.has(i)) next.delete(i)
        else next.add(i)
        anchor.current = i
      }
      onSelect(next)
    },
    [onSelect, readOnly, selected]
  )

  const rangeFor = (i: number): { color: string; label: string } | null => {
    if (!highlightRange) return null
    for (const r of highlightRange) if (i + 1 >= r.from && i + 1 <= r.to) return r
    return null
  }

  return (
    <div
      className={clsx(
        'grid gap-[3px] select-none',
        compact ? 'grid-cols-[repeat(32,minmax(0,1fr))]' : 'grid-cols-[repeat(16,minmax(0,1fr))]'
      )}
      onMouseUp={() => (dragging.current = null)}
      onMouseLeave={() => (dragging.current = null)}
    >
      {Array.from({ length: DMX_CHANNELS }, (_, i) => {
        const v = values[i] ?? 0
        const isSet = setMask ? setMask[i] : v > 0
        const isSel = selected?.has(i)
        const range = rangeFor(i)
        const owner = owners?.[i]
        const t = v / 255
        return (
          <div
            key={i}
            title={`${labelOffset === 0 ? 'Offset' : 'Channel'} ${i + labelOffset} = ${v}${owner ? ` · ${owner}` : ''}${range ? ` · ${range.label}` : ''}`}
            onMouseDown={(e) => {
              select(i, e)
              if (!readOnly && onSelect)
                dragging.current = { start: i, additive: e.ctrlKey || e.metaKey }
            }}
            onMouseEnter={() => {
              if (!dragging.current || !onSelect || readOnly) return
              const [a, b] = [
                Math.min(dragging.current.start, i),
                Math.max(dragging.current.start, i)
              ]
              const next = new Set(dragging.current.additive ? (selected ?? []) : [])
              for (let k = a; k <= b; k++) next.add(k)
              onSelect(next)
            }}
            className={clsx(
              'relative rounded-[4px] border text-center overflow-hidden transition-colors',
              compact ? 'h-5 text-[9px]' : 'h-9 text-[10px]',
              isSel
                ? 'border-accent ring-1 ring-accent'
                : isSet
                  ? 'border-border-strong'
                  : 'border-border/60',
              flash.has(i) && 'flash-cell',
              !readOnly && 'cursor-pointer'
            )}
            style={{
              background:
                isSet || v > 0
                  ? `color-mix(in srgb, ${range?.color ?? 'var(--color-accent)'} ${Math.round(15 + t * 70)}%, var(--app-surface-2))`
                  : range
                    ? `color-mix(in srgb, ${range.color} 8%, var(--app-surface))`
                    : 'var(--app-surface)'
            }}
          >
            {!compact && (
              <div className="absolute top-0.5 left-1 text-faint mono leading-none">
                {i + labelOffset}
              </div>
            )}
            <div
              className={clsx(
                'absolute inset-x-0 mono font-semibold leading-none',
                compact ? 'top-1' : 'bottom-1',
                v > 0 ? 'text-text' : 'text-faint'
              )}
            >
              {compact ? (v ? v : '') : v}
            </div>
          </div>
        )
      })}
    </div>
  )
}
