import React, { useMemo, useState } from 'react'
import clsx from 'clsx'
import { ArrowLeft, Clapperboard, Copy, Play, Plus, Square } from 'lucide-react'
import type { Scene } from '@shared/types/config'
import { LAYER_IDS } from '@shared/constants'
import { uuid } from '@shared/utils'
import { useConfig } from '../../store/config'
import { useRuntime } from '../../store/runtime'
import { invoke } from '../../lib/api'
import { toast } from '../../store/toasts'
import {
  Badge,
  Button,
  EmptyState,
  InlineConfirm,
  PageHeader,
  SearchInput,
  Select
} from '../../components/ui'
import { SceneEditor } from './SceneEditor'

export function ScenesPage(): React.JSX.Element {
  const profile = useConfig((s) => s.draft)
  const update = useConfig((s) => s.update)
  const snapshot = useRuntime((s) => s.snapshot)
  const [editing, setEditing] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')

  const categories = useMemo(
    () => [...new Set((profile?.scenes ?? []).map((s) => s.category || 'General'))].sort(),
    [profile]
  )
  if (!profile) return <></>

  const filtered = profile.scenes.filter(
    (s) =>
      (!q || s.name.toLowerCase().includes(q.toLowerCase())) &&
      (!cat || (s.category || 'General') === cat)
  )

  const create = (): void => {
    const scene: Scene = {
      id: uuid(),
      name: `New scene ${profile.scenes.length + 1}`,
      category: 'General',
      color: '#4cc9f0',
      addressing: profile.simulators.length ? 'relative' : 'absolute',
      defaultUniverse: profile.outputs[0]?.universe ?? 1,
      entries: [],
      behavior: { kind: 'latch' },
      fadeInMs: 0,
      fadeOutMs: 0,
      defaultLayerId:
        profile.layers.find((l) => l.id === LAYER_IDS.scene)?.id ?? profile.layers[0].id,
      showOnDashboard: true,
      notes: ''
    }
    update((d) => ({ ...d, scenes: [...d.scenes, scene] }))
    setEditing(scene.id)
  }
  const duplicate = (s: Scene): void => {
    const copy = {
      ...s,
      id: uuid(),
      name: `${s.name} copy`,
      entries: s.entries.map((e) => ({ ...e }))
    }
    update((d) => ({ ...d, scenes: [...d.scenes, copy] }))
    setEditing(copy.id)
  }
  const remove = (s: Scene): void => {
    const idx = profile.scenes.findIndex((x) => x.id === s.id)
    const usedBy = profile.mappings.filter((m) =>
      m.actions.some(
        (a) => (a.kind === 'activateScene' || a.kind === 'releaseScene') && a.sceneId === s.id
      )
    )
    if (usedBy.length) {
      toast(
        'warn',
        `"${s.name}" is used by ${usedBy.length} mapping(s): ${usedBy.map((m) => m.name).join(', ')}. Remove those actions first.`
      )
      return
    }
    update((d) => ({ ...d, scenes: d.scenes.filter((x) => x.id !== s.id) }))
    toast('info', `Deleted "${s.name}"`, () =>
      update((d) => ({ ...d, scenes: [...d.scenes.slice(0, idx), s, ...d.scenes.slice(idx)] }))
    )
    if (editing === s.id) setEditing(null)
  }

  if (editing) {
    const scene = profile.scenes.find((s) => s.id === editing)
    if (!scene) {
      setEditing(null)
      return <></>
    }
    return (
      <div className="max-w-6xl mx-auto">
        <PageHeader
          title={scene.name || 'Untitled scene'}
          subtitle={`${scene.addressing === 'relative' ? 'Relative scene' : `Absolute · universe ${scene.defaultUniverse}`} · ${profile.layers.find((l) => l.id === scene.defaultLayerId)?.name ?? '?'} layer`}
          actions={
            <>
              <Button icon={<ArrowLeft size={16} />} onClick={() => setEditing(null)}>
                Back to list
              </Button>
              <Button
                variant="success"
                icon={<Play size={16} />}
                onClick={() => void invoke('scene.activate', scene.id, null)}
              >
                Activate
              </Button>
              <Button
                icon={<Square size={16} />}
                onClick={() => void invoke('scene.release', scene.id, null)}
              >
                Release
              </Button>
            </>
          }
        />
        <SceneEditor
          scene={scene}
          onChange={(s) =>
            update((d) => ({ ...d, scenes: d.scenes.map((x) => (x.id === s.id ? s : x)) }))
          }
        />
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        title="Scenes"
        subtitle="A scene is a set of DMX channel values. Mappings and Dashboard buttons activate scenes on a layer."
        actions={
          <Button variant="primary" icon={<Plus size={16} />} onClick={create}>
            New scene
          </Button>
        }
      />
      <div className="flex items-center gap-2 mb-4">
        <SearchInput value={q} onChange={setQ} placeholder="Search scenes…" className="w-72" />
        <Select
          value={cat}
          onChange={setCat}
          options={[
            { value: '', label: 'All categories' },
            ...categories.map((c) => ({ value: c, label: c }))
          ]}
          className="w-48"
        />
        <span className="text-muted text-[13px] ml-auto">
          {filtered.length} of {profile.scenes.length}
        </span>
      </div>
      {profile.scenes.length === 0 ? (
        <EmptyState
          icon={<Clapperboard size={28} />}
          title="No scenes yet"
          body="Create a scene, pick the channels it sets, then map a Thorium or MQTT event to it."
          action={
            <Button variant="primary" icon={<Plus size={16} />} onClick={create}>
              New scene
            </Button>
          }
        />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-[13px]">
            <thead className="bg-surface-2 text-muted text-[12px] uppercase tracking-wider">
              <tr>
                <th className="text-left font-semibold px-4 py-2.5">Scene</th>
                <th className="text-left font-semibold px-3 py-2.5">Category</th>
                <th className="text-left font-semibold px-3 py-2.5">Addressing</th>
                <th className="text-left font-semibold px-3 py-2.5">Channels</th>
                <th className="text-left font-semibold px-3 py-2.5">Behavior</th>
                <th className="text-left font-semibold px-3 py-2.5">Layer</th>
                <th className="text-right font-semibold px-4 py-2.5">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => {
                const active = snapshot?.compositor.active.some((a) => a.sceneId === s.id)
                return (
                  <tr
                    key={s.id}
                    className={clsx(
                      'border-t border-border hover:bg-surface-2 cursor-pointer',
                      active && 'bg-success/5'
                    )}
                    onClick={() => setEditing(s.id)}
                  >
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <span
                          className="w-3 h-3 rounded-full shrink-0"
                          style={{ background: s.color }}
                        />
                        <span className="font-medium">{s.name}</span>
                        {active && <Badge tone="success">active</Badge>}
                        {!s.showOnDashboard && <Badge>hidden</Badge>}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-muted">{s.category || 'General'}</td>
                    <td className="px-3 py-2.5 text-muted">
                      {s.addressing === 'relative' ? 'Relative' : `U${s.defaultUniverse}`}
                    </td>
                    <td className="px-3 py-2.5 mono">{s.entries.length}</td>
                    <td className="px-3 py-2.5 text-muted">
                      {s.behavior.kind === 'timed' ? `${s.behavior.holdMs} ms` : 'Latch'}
                      {s.fadeInMs || s.fadeOutMs ? ` · fade ${s.fadeInMs}/${s.fadeOutMs}` : ''}
                    </td>
                    <td className="px-3 py-2.5 text-muted">
                      {profile.layers.find((l) => l.id === s.defaultLayerId)?.name ?? '?'}
                    </td>
                    <td className="px-4 py-2.5">
                      <div
                        className="flex items-center justify-end gap-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Button
                          size="sm"
                          variant="success"
                          icon={<Play size={13} />}
                          onClick={() => void invoke('scene.activate', s.id, null)}
                        >
                          Go
                        </Button>
                        <Button
                          size="sm"
                          icon={<Square size={13} />}
                          onClick={() => void invoke('scene.release', s.id, null)}
                        />
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={<Copy size={13} />}
                          onClick={() => duplicate(s)}
                        />
                        <InlineConfirm onConfirm={() => remove(s)} label="Delete" />
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
