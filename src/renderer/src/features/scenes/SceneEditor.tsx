import React, { useEffect, useMemo, useState } from 'react'
import { Eye, EyeOff, Plus, Trash2 } from 'lucide-react'
import type { ChannelEntry, Scene } from '@shared/types/config'
import { DMX_CHANNELS, LAYER_IDS } from '@shared/constants'
import { useConfig } from '../../store/config'
import { useRuntime } from '../../store/runtime'
import { invoke } from '../../lib/api'
import {
  Button,
  Callout,
  Card,
  Checkbox,
  Field,
  Input,
  NumberInput,
  Select,
  Slider,
  Switch,
  TextArea
} from '../../components/ui'
import { ChannelGrid } from './ChannelGrid'
import { parseBulk } from './bulk'

const COLORS = [
  '#4cc9f0',
  '#3ddc97',
  '#ffe066',
  '#ffb454',
  '#ff5d5d',
  '#a78bfa',
  '#f472b6',
  '#e6edf3'
]

function entriesToArrays(scene: Scene): { values: number[]; mask: boolean[] } {
  const values = new Array(DMX_CHANNELS).fill(0)
  const mask = new Array(DMX_CHANNELS).fill(false)
  const base = scene.addressing === 'relative' ? 0 : 1
  for (const e of scene.entries) {
    const idx = e.channel - base
    if (
      idx >= 0 &&
      idx < DMX_CHANNELS &&
      (scene.addressing === 'relative' ||
        (e.universe ?? scene.defaultUniverse) === scene.defaultUniverse)
    ) {
      values[idx] = e.value
      mask[idx] = true
    }
  }
  return { values, mask }
}

export function SceneEditor({
  scene,
  onChange
}: {
  scene: Scene
  onChange: (s: Scene) => void
}): React.JSX.Element {
  const profile = useConfig((s) => s.draft)!
  const snapshot = useRuntime((s) => s.snapshot)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [bulk, setBulk] = useState('')
  const [preview, setPreview] = useState(false)
  const [previewSim, setPreviewSim] = useState<string>(profile.simulators[0]?.name ?? '')
  const { values, mask } = useMemo(() => entriesToArrays(scene), [scene])
  const isRel = scene.addressing === 'relative'

  const setEntries = (entries: ChannelEntry[]): void => onChange({ ...scene, entries })

  const applyValue = (v: number): void => {
    if (selected.size === 0) return
    const base = isRel ? 0 : 1
    const map = new Map(
      scene.entries
        .filter((e) => isRel || (e.universe ?? scene.defaultUniverse) === scene.defaultUniverse)
        .map((e) => [e.channel, e])
    )
    for (const idx of selected) map.set(idx + base, { channel: idx + base, value: v })
    const others = isRel
      ? []
      : scene.entries.filter((e) => (e.universe ?? scene.defaultUniverse) !== scene.defaultUniverse)
    setEntries([...others, ...[...map.values()].sort((a, b) => a.channel - b.channel)])
  }
  const clearSelected = (): void => {
    const base = isRel ? 0 : 1
    setEntries(scene.entries.filter((e) => !selected.has(e.channel - base)))
    setSelected(new Set())
  }
  const applyBulk = (): void => {
    const parsed = parseBulk(bulk)
    if (!parsed.length) return
    const base = isRel ? 0 : 1
    const map = new Map(scene.entries.map((e) => [e.channel, e]))
    for (const p of parsed) {
      const ch = isRel ? p.channel : p.channel
      if (ch - base < 0 || ch - base >= DMX_CHANNELS) continue
      map.set(ch, { channel: ch, value: p.value })
    }
    setEntries([...map.values()].sort((a, b) => a.channel - b.channel))
    setBulk('')
  }

  // Live preview on the Test layer while enabled.
  useEffect(() => {
    if (!preview) return
    const sim = profile.simulators.find((s) => s.name === previewSim)
    const universe = isRel ? (sim?.universe ?? scene.defaultUniverse) : scene.defaultUniverse
    const base = isRel ? (sim?.baseAddress ?? 1) : 0
    const applied: number[] = []
    for (const e of scene.entries) {
      const ch = isRel ? base + e.channel : e.channel
      if (ch < 1 || ch > DMX_CHANNELS) continue
      void invoke('dmx.setTestChannel', universe, ch, e.value)
      applied.push(ch)
    }
    return () => {
      void invoke('dmx.clearTest')
    }
  }, [
    preview,
    scene.entries,
    scene.addressing,
    scene.defaultUniverse,
    previewSim,
    profile.simulators,
    isRel
  ])

  const selValue = selected.size ? values[[...selected][0]] : 0
  const simRanges = isRel
    ? []
    : profile.simulators
        .filter((s) => s.universe === scene.defaultUniverse)
        .map((s) => ({
          from: s.baseAddress,
          to: Math.min(512, s.baseAddress + 49),
          color: s.color,
          label: s.name
        }))
  const hasOutputForUniverse =
    !isRel && profile.outputs.some((o) => o.enabled && o.universe === scene.defaultUniverse)

  return (
    <div className="grid grid-cols-[1fr_320px] gap-5 items-start">
      <div className="flex flex-col gap-4">
        <Card>
          <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
            <div className="flex items-center gap-2">
              <Select
                value={scene.addressing}
                onChange={(v) =>
                  onChange({ ...scene, addressing: v as Scene['addressing'], entries: [] })
                }
                options={[
                  { value: 'relative', label: 'Relative to simulator base' },
                  { value: 'absolute', label: 'Absolute universe/channel' }
                ]}
                className="w-64"
              />
              {!isRel && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[12px] text-muted">Universe</span>
                  <NumberInput
                    value={scene.defaultUniverse}
                    min={1}
                    max={63999}
                    onChange={(v) => onChange({ ...scene, defaultUniverse: v })}
                    className="!w-24"
                  />
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              {isRel && (
                <Select
                  value={previewSim}
                  onChange={setPreviewSim}
                  options={profile.simulators.map((s) => ({
                    value: s.name,
                    label: `${s.name} (U${s.universe} @${s.baseAddress})`
                  }))}
                  placeholder="Preview as…"
                  className="w-56"
                />
              )}
              <Button
                size="sm"
                variant={preview ? 'warning' : 'secondary'}
                icon={preview ? <EyeOff size={14} /> : <Eye size={14} />}
                onClick={() => setPreview(!preview)}
                disabled={!snapshot || snapshot.compositor.universes.length === 0}
              >
                {preview ? 'Stop live preview' : 'Live preview'}
              </Button>
            </div>
          </div>
          {preview && (
            <Callout tone="warning" className="mb-3">
              Sending this scene on the <b>Test</b> layer to the outputs while this editor is open
              {isRel && previewSim ? ` (as ${previewSim})` : ''}.
            </Callout>
          )}
          {!isRel && !hasOutputForUniverse && (
            <Callout tone="muted" className="mb-3">
              No enabled output carries universe {scene.defaultUniverse}. The scene will composite
              but nothing will be sent.
            </Callout>
          )}
          <ChannelGrid
            values={values}
            setMask={mask}
            selected={selected}
            onSelect={setSelected}
            labelOffset={isRel ? 0 : 1}
            highlightRange={simRanges}
          />
          <div className="text-[12px] text-faint mt-2">
            Click to select · Shift-click for a range · Drag to paint · ⌘/Ctrl-click to add.{' '}
            {isRel
              ? 'Numbers are offsets from the simulator base address.'
              : 'Simulator ranges are tinted by their colors.'}
          </div>
        </Card>

        <Card>
          <div className="flex items-center gap-4">
            <div className="grow">
              <div className="flex items-center justify-between mb-1">
                <span className="field-label !mb-0">
                  {selected.size ? `${selected.size} selected` : 'Select channels to set a value'}
                </span>
                <span className="mono text-[13px]">{selected.size ? selValue : '—'}</span>
              </div>
              <Slider
                value={selValue}
                onChange={applyValue}
                min={0}
                max={255}
                disabled={selected.size === 0}
              />
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {[0, 128, 255].map((v) => (
                <Button
                  key={v}
                  size="sm"
                  disabled={selected.size === 0}
                  onClick={() => applyValue(v)}
                >
                  {v}
                </Button>
              ))}
              <Button
                size="sm"
                variant="danger"
                icon={<Trash2 size={14} />}
                disabled={selected.size === 0}
                onClick={clearSelected}
              >
                Unset
              </Button>
            </div>
          </div>
          <div className="flex items-end gap-2 mt-4">
            <Field
              label="Bulk entry"
              hint="e.g. 1-8=255, 12=128, 20 (value defaults to 255)"
              className="grow"
            >
              <Input
                value={bulk}
                onChange={(e) => setBulk(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && applyBulk()}
                placeholder="1-8=255, 12=128"
                className="mono"
              />
            </Field>
            <Button
              icon={<Plus size={16} />}
              onClick={applyBulk}
              disabled={!bulk.trim()}
              className="mb-5"
            >
              Apply
            </Button>
          </div>
        </Card>
      </div>

      <div className="flex flex-col gap-4">
        <Card>
          <Field label="Name">
            <Input
              value={scene.name}
              onChange={(e) => onChange({ ...scene, name: e.target.value })}
            />
          </Field>
          <Field label="Category" className="mt-3" hint="Groups buttons on the Dashboard">
            <Input
              value={scene.category}
              onChange={(e) => onChange({ ...scene, category: e.target.value })}
              list="scene-categories"
            />
            <datalist id="scene-categories">
              {[...new Set(profile.scenes.map((s) => s.category))].map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>
          <Field label="Color" className="mt-3">
            <div className="flex items-center gap-1.5 flex-wrap">
              {COLORS.map((c) => (
                <button
                  key={c}
                  aria-label={c}
                  className="w-7 h-7 rounded-full border-2"
                  style={{
                    background: c,
                    borderColor: scene.color === c ? 'white' : 'transparent'
                  }}
                  onClick={() => onChange({ ...scene, color: c })}
                />
              ))}
              <input
                type="color"
                value={scene.color}
                onChange={(e) => onChange({ ...scene, color: e.target.value })}
                className="w-7 h-7 rounded-full bg-transparent border-0 cursor-pointer"
              />
            </div>
          </Field>
          <Field label="Layer" className="mt-3">
            <Select
              value={scene.defaultLayerId}
              onChange={(v) => onChange({ ...scene, defaultLayerId: v })}
              options={profile.layers
                .filter((l) => l.id !== LAYER_IDS.test && l.id !== LAYER_IDS.blackout)
                .map((l) => ({ value: l.id, label: `${l.name} (${l.priority})` }))}
            />
          </Field>
          <div className="mt-3">
            <Checkbox
              checked={scene.showOnDashboard}
              onChange={(v) => onChange({ ...scene, showOnDashboard: v })}
              label="Show on Dashboard"
            />
          </div>
        </Card>
        <Card>
          <Field label="Behavior">
            <Select
              value={scene.behavior.kind}
              onChange={(v) =>
                onChange({
                  ...scene,
                  behavior: v === 'timed' ? { kind: 'timed', holdMs: 1000 } : { kind: 'latch' }
                })
              }
              options={[
                { value: 'latch', label: 'Latch (stays until released)' },
                { value: 'timed', label: 'Timed (auto-release after hold)' }
              ]}
            />
          </Field>
          {scene.behavior.kind === 'timed' && (
            <Field label="Hold (ms)" className="mt-3">
              <NumberInput
                value={scene.behavior.holdMs}
                min={0}
                step={100}
                onChange={(v) => onChange({ ...scene, behavior: { kind: 'timed', holdMs: v } })}
              />
            </Field>
          )}
          <div className="grid grid-cols-2 gap-3 mt-3">
            <Field label="Fade in (ms)">
              <NumberInput
                value={scene.fadeInMs}
                min={0}
                step={100}
                onChange={(v) => onChange({ ...scene, fadeInMs: v })}
              />
            </Field>
            <Field label="Fade out (ms)">
              <NumberInput
                value={scene.fadeOutMs}
                min={0}
                step={100}
                onChange={(v) => onChange({ ...scene, fadeOutMs: v })}
              />
            </Field>
          </div>
        </Card>
        <Card>
          <Field label="Notes">
            <TextArea
              value={scene.notes}
              onChange={(e) => onChange({ ...scene, notes: e.target.value })}
              rows={3}
            />
          </Field>
          <div className="text-[12px] text-muted mt-3">
            {scene.entries.length} channel{scene.entries.length === 1 ? '' : 's'} set
          </div>
        </Card>
        <div className="hidden">
          <Switch checked={false} onChange={() => undefined} />
        </div>
      </div>
    </div>
  )
}
