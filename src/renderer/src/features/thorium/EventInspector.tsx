import React, { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { ChevronDown, ChevronRight, Pause, Play, Plus, Trash2 } from 'lucide-react'
import type { AppEvent } from '@shared/types/events'
import { useEvents } from '../../store/events'
import { useConfig } from '../../store/config'
import { compactJson, fmtTime } from '../../lib/format'
import { Badge, Button, Checkbox, SearchInput, Select } from '../../components/ui'

const SOURCE_TONE = { thorium: 'accent', mqtt: 'info', ui: 'success', system: 'muted' } as const

export function EventInspector({
  onCreateTrigger,
  compact
}: {
  onCreateTrigger?: (e: AppEvent) => void
  compact?: boolean
}): React.JSX.Element {
  const events = useEvents((s) => s.events)
  const paused = useEvents((s) => s.paused)
  const setPaused = useEvents((s) => s.setPaused)
  const clear = useEvents((s) => s.clear)
  const profile = useConfig((s) => s.draft)
  const [q, setQ] = useState('')
  const [source, setSource] = useState('')
  const [onlyMatched, setOnlyMatched] = useState(false)
  const [hideNoise, setHideNoise] = useState(true)
  const [open, setOpen] = useState<string | null>(null)
  const [follow, setFollow] = useState(true)
  const listRef = useRef<HTMLDivElement>(null)

  const noise = useMemo(
    () =>
      new Set([
        'clientPing',
        'clientSetCard',
        'clockSync',
        'sensorContactMove',
        'thrustersUpdate',
        'updateSpeed',
        'setTrackingPreference',
        'reactorBatteryChargeLevel',
        'engineUpdate',
        'crmMovement',
        'shipStructure'
      ]),
    []
  )
  const filtered = useMemo(
    () =>
      events.filter((e) => {
        if (source && e.source !== source) return false
        if (onlyMatched && e.matchedMappingIds.length === 0) return false
        if (hideNoise && e.type === 'thorium.event' && noise.has(e.name)) return false
        if (q) {
          const s = q.toLowerCase()
          if (
            !e.name.toLowerCase().includes(s) &&
            !(e.simulatorName ?? '').toLowerCase().includes(s) &&
            !JSON.stringify(e.data).toLowerCase().includes(s)
          )
            return false
        }
        return true
      }),
    [events, source, onlyMatched, hideNoise, noise, q]
  )
  const shown = filtered.slice(-400)

  useEffect(() => {
    if (follow && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
  }, [shown.length, follow])

  const mappingName = (id: string): string => profile?.mappings.find((m) => m.id === id)?.name ?? id

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <SearchInput
          value={q}
          onChange={setQ}
          placeholder="Filter by name, simulator or data…"
          className="w-64"
        />
        <Select
          value={source}
          onChange={setSource}
          options={[
            { value: '', label: 'All sources' },
            { value: 'thorium', label: 'Thorium' },
            { value: 'mqtt', label: 'MQTT' },
            { value: 'ui', label: 'UI' },
            { value: 'system', label: 'System' }
          ]}
          className="w-36"
        />
        <Checkbox checked={onlyMatched} onChange={setOnlyMatched} label="Matched only" />
        <Checkbox checked={hideNoise} onChange={setHideNoise} label="Hide noisy events" />
        <span className="ml-auto flex items-center gap-1.5">
          <span className="text-[12px] text-muted">{shown.length} shown</span>
          <Button
            size="sm"
            variant="ghost"
            icon={paused ? <Play size={13} /> : <Pause size={13} />}
            onClick={() => setPaused(!paused)}
          >
            {paused ? 'Resume' : 'Pause'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={<Trash2 size={13} />}
            onClick={() => void clear()}
          />
        </span>
      </div>
      <div
        ref={listRef}
        onScroll={(e) =>
          setFollow(
            e.currentTarget.scrollTop + e.currentTarget.clientHeight >=
              e.currentTarget.scrollHeight - 20
          )
        }
        className={clsx(
          'card overflow-y-auto grow min-h-0 mono text-[12px]',
          compact ? 'max-h-[360px]' : 'max-h-[calc(100vh-320px)]'
        )}
      >
        {shown.length === 0 ? (
          <div className="p-6 text-center text-muted font-sans">
            No events yet. When Thorium or MQTT sends something it appears here.
          </div>
        ) : (
          shown.map((e) => {
            const isOpen = open === e.id
            return (
              <div
                key={e.id}
                className={clsx(
                  'border-b border-border/60',
                  e.matchedMappingIds.length && 'bg-accent/5'
                )}
              >
                <div
                  className="flex items-center gap-2 px-2.5 py-1.5 cursor-pointer hover:bg-surface-2"
                  onClick={() => setOpen(isOpen ? null : e.id)}
                >
                  {isOpen ? (
                    <ChevronDown size={13} className="text-faint" />
                  ) : (
                    <ChevronRight size={13} className="text-faint" />
                  )}
                  <span className="text-faint shrink-0">{fmtTime(e.ts)}</span>
                  <Badge tone={SOURCE_TONE[e.source]}>{e.source}</Badge>
                  <span
                    className={clsx('font-semibold', e.type === 'thorium.state' && 'text-info')}
                  >
                    {e.name}
                  </span>
                  {e.simulatorName && <span className="text-muted">[{e.simulatorName}]</span>}
                  <span className="text-faint truncate grow">
                    {compactJson(stripNoise(e.data), 120)}
                  </span>
                  {e.matchedMappingIds.length > 0 && (
                    <Badge tone="accent">
                      {e.matchedMappingIds.length} rule{e.matchedMappingIds.length > 1 ? 's' : ''}
                    </Badge>
                  )}
                </div>
                {isOpen && (
                  <div className="px-8 pb-3 font-sans">
                    <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[12px] mb-2">
                      <span className="text-muted">Type</span>
                      <span className="mono">{e.type}</span>
                      <span className="text-muted">Matched</span>
                      <span>
                        {e.matchedMappingIds.length
                          ? e.matchedMappingIds.map(mappingName).join(', ')
                          : 'no mappings'}
                      </span>
                    </div>
                    <pre className="mono text-[11px] bg-surface-2 rounded-lg p-2.5 overflow-x-auto max-h-64 select-text">
                      {JSON.stringify(e.data, null, 2)}
                    </pre>
                    {onCreateTrigger &&
                      (e.type === 'thorium.event' ||
                        e.type === 'mqtt.message' ||
                        e.type === 'thorium.state') && (
                        <Button
                          size="sm"
                          variant="primary"
                          icon={<Plus size={13} />}
                          className="mt-2"
                          onClick={() => onCreateTrigger(e)}
                        >
                          Create mapping from this event
                        </Button>
                      )}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

function stripNoise(d: Record<string, unknown>): Record<string, unknown> {
  const out = { ...d }
  for (const k of ['event', 'clientId', 'isMutation', 'core']) delete out[k]
  return out
}
