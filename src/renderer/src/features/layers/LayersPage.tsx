import React from 'react'
import { ArrowDown, ArrowUp, Eraser, Layers, Lock, Plus } from 'lucide-react'
import type { Layer } from '@shared/types/config'
import { uuid } from '@shared/utils'
import { useConfig } from '../../store/config'
import { useRuntime } from '../../store/runtime'
import { invoke } from '../../lib/api'
import { toast } from '../../store/toasts'
import {
  Badge,
  Button,
  Callout,
  Input,
  InlineConfirm,
  NumberInput,
  PageHeader
} from '../../components/ui'

export function LayersPage(): React.JSX.Element {
  const profile = useConfig((s) => s.draft)
  const update = useConfig((s) => s.update)
  const snapshot = useRuntime((s) => s.snapshot)
  if (!profile) return <></>
  const layers = [...profile.layers].sort((a, b) => b.priority - a.priority)
  const setLayers = (ls: Layer[]): void => update((d) => ({ ...d, layers: ls }))
  const patch = (id: string, p: Partial<Layer>): void =>
    setLayers(profile.layers.map((l) => (l.id === id ? { ...l, ...p } : l)))
  const add = (): void => {
    const max = Math.max(0, ...profile.layers.filter((l) => !l.locked).map((l) => l.priority))
    setLayers([
      ...profile.layers,
      {
        id: uuid(),
        name: `Layer ${profile.layers.length + 1}`,
        priority: Math.min(89, max + 10),
        locked: false
      }
    ])
  }
  const remove = (l: Layer): void => {
    const used = profile.scenes.filter((s) => s.defaultLayerId === l.id)
    if (used.length) {
      toast(
        'warn',
        `"${l.name}" is the default layer of ${used.length} scene(s). Change those first.`
      )
      return
    }
    setLayers(profile.layers.filter((x) => x.id !== l.id))
  }
  const nudge = (l: Layer, dir: 1 | -1): void =>
    patch(l.id, { priority: Math.max(0, Math.min(89, l.priority + dir * 5)) })

  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader
        title="Layers"
        subtitle="Higher priority wins per channel. When a scene on a higher layer ends, the layer below shows through."
        actions={
          <Button variant="primary" icon={<Plus size={16} />} onClick={add}>
            Add layer
          </Button>
        }
      />
      <Callout tone="muted" className="mb-4">
        <b>Test</b> (90) and <b>Blackout</b> (100) are reserved for the channel tester, live preview
        and the Blackout button. Keep your own layers below 90.
      </Callout>
      <div className="flex flex-col gap-2">
        {layers.map((l) => {
          const active = snapshot?.compositor.active.filter((a) => a.layerId === l.id) ?? []
          return (
            <div key={l.id} className="card px-4 py-3 flex items-center gap-4">
              <div className="w-12 text-center">
                <div className="mono text-lg font-semibold">{l.priority}</div>
                <div className="text-[10px] text-faint uppercase">priority</div>
              </div>
              <div className="grow min-w-0">
                <div className="flex items-center gap-2">
                  {l.locked ? (
                    <span className="font-medium flex items-center gap-1.5">
                      <Lock size={13} className="text-faint" /> {l.name}
                    </span>
                  ) : (
                    <Input
                      value={l.name}
                      onChange={(e) => patch(l.id, { name: e.target.value })}
                      className="!h-8 !w-56"
                    />
                  )}
                  {active.length > 0 && <Badge tone="success">{active.length} active</Badge>}
                </div>
                <div className="text-[12px] text-muted mt-1 truncate">
                  {active.length
                    ? active
                        .map(
                          (a) =>
                            `${a.sceneName}${a.simulatorName ? ' (' + a.simulatorName + ')' : ''}`
                        )
                        .join(', ')
                    : `${profile.scenes.filter((s) => s.defaultLayerId === l.id).length} scene(s) default here`}
                </div>
              </div>
              {!l.locked && (
                <div className="flex items-center gap-1">
                  <NumberInput
                    value={l.priority}
                    min={0}
                    max={89}
                    onChange={(v) => patch(l.id, { priority: v })}
                    className="!w-20 !h-8"
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<ArrowUp size={14} />}
                    onClick={() => nudge(l, 1)}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<ArrowDown size={14} />}
                    onClick={() => nudge(l, -1)}
                  />
                </div>
              )}
              <Button
                size="sm"
                icon={<Eraser size={14} />}
                disabled={active.length === 0}
                onClick={() => void invoke('compositor.releaseLayer', l.id)}
              >
                Release
              </Button>
              {!l.locked && <InlineConfirm onConfirm={() => remove(l)} />}
            </div>
          )
        })}
      </div>
      <div className="text-faint text-[12px] mt-4 flex items-center gap-1.5">
        <Layers size={13} /> Within one layer, the most recently activated scene wins for channels
        both set.
      </div>
    </div>
  )
}
