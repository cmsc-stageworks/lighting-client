import React from 'react'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import type { Action, ActionTarget } from '@shared/types/config'
import { LAYER_IDS } from '@shared/constants'
import { useConfig } from '../../store/config'
import { useRuntime } from '../../store/runtime'
import { Button, Checkbox, Field, Input, NumberInput, Select, TextArea } from '../../components/ui'

const KIND_LABELS: Record<Action['kind'], string> = {
  activateScene: 'Activate scene',
  releaseScene: 'Release scene',
  releaseLayer: 'Release layer',
  releaseAll: 'Release all scenes',
  blackout: 'Blackout',
  publishMqtt: 'Publish MQTT message',
  thoriumMutation: 'Send to Thorium'
}

function defaultAction(kind: Action['kind'], firstSceneId: string, firstLayerId: string): Action {
  switch (kind) {
    case 'activateScene':
      return { kind, sceneId: firstSceneId, target: 'event', layerId: null, holdMsOverride: null }
    case 'releaseScene':
      return { kind, sceneId: firstSceneId, target: 'event' }
    case 'releaseLayer':
      return { kind, layerId: firstLayerId, target: 'all' }
    case 'releaseAll':
      return { kind }
    case 'blackout':
      return { kind, on: true }
    case 'publishMqtt':
      return {
        kind,
        topic: '',
        payload: '{"event":"{{ name }}","simulator":"{{ simulatorName }}"}',
        qos: 0,
        retain: false
      }
    case 'thoriumMutation':
      return { kind, mutation: { kind: 'triggerMacro', macroName: '' } }
  }
}

function TargetSelect({
  value,
  onChange
}: {
  value: ActionTarget
  onChange: (t: ActionTarget) => void
}): React.JSX.Element {
  const profile = useConfig((s) => s.draft)!
  const v = value === 'event' ? 'event' : value === 'all' ? 'all' : `sim:${value.simulatorName}`
  return (
    <Select
      value={v}
      onChange={(x) =>
        onChange(x === 'event' ? 'event' : x === 'all' ? 'all' : { simulatorName: x.slice(4) })
      }
      options={[
        { value: 'event', label: "The event's simulator" },
        { value: 'all', label: 'All simulators in scope' },
        ...profile.simulators.map((s) => ({ value: `sim:${s.name}`, label: `Only ${s.name}` }))
      ]}
    />
  )
}

export function ActionsEditor({
  actions,
  onChange
}: {
  actions: Action[]
  onChange: (a: Action[]) => void
}): React.JSX.Element {
  const profile = useConfig((s) => s.draft)!
  const refData = useRuntime((s) => s.refData)
  const scenes = profile.scenes
  const layers = profile.layers.filter(
    (l) => l.id !== LAYER_IDS.test && l.id !== LAYER_IDS.blackout
  )
  const setAt = (i: number, a: Action): void => onChange(actions.map((x, k) => (k === i ? a : x)))
  const move = (i: number, d: -1 | 1): void => {
    const j = i + d
    if (j < 0 || j >= actions.length) return
    const next = [...actions]
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }

  return (
    <div className="flex flex-col gap-3">
      {actions.length === 0 && (
        <div className="text-[13px] text-faint">No actions yet. Add at least one.</div>
      )}
      {actions.map((a, i) => (
        <div key={i} className="card p-3 flex gap-3">
          <div className="flex flex-col gap-1 shrink-0">
            <Button
              size="sm"
              variant="ghost"
              icon={<ArrowUp size={13} />}
              onClick={() => move(i, -1)}
              disabled={i === 0}
            />
            <Button
              size="sm"
              variant="ghost"
              icon={<ArrowDown size={13} />}
              onClick={() => move(i, 1)}
              disabled={i === actions.length - 1}
            />
          </div>
          <div className="grow grid grid-cols-2 gap-3">
            <Field label="Action">
              <Select
                value={a.kind}
                onChange={(k) =>
                  setAt(
                    i,
                    defaultAction(k as Action['kind'], scenes[0]?.id ?? '', layers[0]?.id ?? '')
                  )
                }
                options={(Object.keys(KIND_LABELS) as Action['kind'][]).map((k) => ({
                  value: k,
                  label: KIND_LABELS[k]
                }))}
              />
            </Field>
            {a.kind === 'activateScene' && (
              <>
                <Field label="Scene">
                  <Select
                    value={a.sceneId}
                    onChange={(v) => setAt(i, { ...a, sceneId: v })}
                    options={scenes.map((s) => ({ value: s.id, label: s.name }))}
                    placeholder="Choose a scene"
                  />
                </Field>
                <Field label="For">
                  <TargetSelect value={a.target} onChange={(t) => setAt(i, { ...a, target: t })} />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Layer">
                    <Select
                      value={a.layerId ?? ''}
                      onChange={(v) => setAt(i, { ...a, layerId: v || null })}
                      options={[
                        { value: '', label: "Scene's default" },
                        ...layers.map((l) => ({ value: l.id, label: l.name }))
                      ]}
                    />
                  </Field>
                  <Field label="Hold override (ms)" hint="blank = scene setting">
                    <Input
                      type="number"
                      min={0}
                      value={a.holdMsOverride ?? ''}
                      onChange={(e) =>
                        setAt(i, {
                          ...a,
                          holdMsOverride:
                            e.target.value === '' ? null : Math.max(0, Number(e.target.value))
                        })
                      }
                      className="mono"
                    />
                  </Field>
                </div>
              </>
            )}
            {a.kind === 'releaseScene' && (
              <>
                <Field label="Scene">
                  <Select
                    value={a.sceneId}
                    onChange={(v) => setAt(i, { ...a, sceneId: v })}
                    options={scenes.map((s) => ({ value: s.id, label: s.name }))}
                    placeholder="Choose a scene"
                  />
                </Field>
                <Field label="For">
                  <TargetSelect value={a.target} onChange={(t) => setAt(i, { ...a, target: t })} />
                </Field>
              </>
            )}
            {a.kind === 'releaseLayer' && (
              <>
                <Field label="Layer">
                  <Select
                    value={a.layerId}
                    onChange={(v) => setAt(i, { ...a, layerId: v })}
                    options={layers.map((l) => ({ value: l.id, label: l.name }))}
                  />
                </Field>
                <Field label="For">
                  <Select
                    value={a.target}
                    onChange={(v) => setAt(i, { ...a, target: v as 'event' | 'all' })}
                    options={[
                      { value: 'all', label: 'All simulators' },
                      { value: 'event', label: "The event's simulator" }
                    ]}
                  />
                </Field>
              </>
            )}
            {a.kind === 'blackout' && (
              <Field label="State">
                <Select
                  value={a.on ? 'on' : 'off'}
                  onChange={(v) => setAt(i, { ...a, on: v === 'on' })}
                  options={[
                    { value: 'on', label: 'Blackout ON' },
                    { value: 'off', label: 'Blackout OFF (release)' }
                  ]}
                />
              </Field>
            )}
            {a.kind === 'publishMqtt' && (
              <>
                <Field
                  label="Topic"
                  hint="Templates: {{ name }}, {{ simulatorName }}, {{ data.x }}"
                >
                  <Input
                    value={a.topic}
                    onChange={(e) => setAt(i, { ...a, topic: e.target.value })}
                    className="mono"
                    placeholder="cmsc/lighting/events/alert"
                  />
                </Field>
                <div className="col-span-2">
                  <Field label="Payload" hint="{{ json data }} inserts the event data as JSON">
                    <TextArea
                      value={a.payload}
                      onChange={(e) => setAt(i, { ...a, payload: e.target.value })}
                      rows={2}
                      className="mono"
                    />
                  </Field>
                </div>
                <div className="flex items-center gap-4">
                  <Select
                    value={String(a.qos)}
                    onChange={(v) => setAt(i, { ...a, qos: Number(v) as 0 | 1 | 2 })}
                    options={[
                      { value: '0', label: 'QoS 0' },
                      { value: '1', label: 'QoS 1' },
                      { value: '2', label: 'QoS 2' }
                    ]}
                    className="w-28"
                  />
                  <Checkbox
                    checked={a.retain}
                    onChange={(v) => setAt(i, { ...a, retain: v })}
                    label="Retain"
                  />
                </div>
              </>
            )}
            {a.kind === 'thoriumMutation' && (
              <>
                <Field label="What">
                  <Select
                    value={a.mutation.kind}
                    onChange={(v) =>
                      setAt(i, {
                        ...a,
                        mutation:
                          v === 'triggerMacro'
                            ? { kind: 'triggerMacro', macroName: '' }
                            : v === 'setAlertLevel'
                              ? { kind: 'setAlertLevel', level: '5' }
                              : { kind: 'notify', title: '', body: '', color: 'info' }
                      })
                    }
                    options={[
                      { value: 'triggerMacro', label: 'Trigger a macro' },
                      { value: 'setAlertLevel', label: 'Set alert level' },
                      { value: 'notify', label: 'Notify the Flight Director' }
                    ]}
                  />
                </Field>
                {a.mutation.kind === 'triggerMacro' && (
                  <Field label="Macro name">
                    <Input
                      value={a.mutation.macroName}
                      onChange={(e) =>
                        setAt(i, {
                          ...a,
                          mutation: { kind: 'triggerMacro', macroName: e.target.value }
                        })
                      }
                      list="macro-names"
                    />
                    <datalist id="macro-names">
                      {refData.macros.map((m) => (
                        <option key={m.id} value={m.name} />
                      ))}
                    </datalist>
                  </Field>
                )}
                {a.mutation.kind === 'setAlertLevel' && (
                  <Field label="Level">
                    <Select
                      value={a.mutation.level}
                      onChange={(v) =>
                        setAt(i, {
                          ...a,
                          mutation: {
                            kind: 'setAlertLevel',
                            level: v as '1' | '2' | '3' | '4' | '5' | 'p'
                          }
                        })
                      }
                      options={['5', '4', '3', '2', '1', 'p'].map((l) => ({
                        value: l,
                        label: `Level ${l.toUpperCase()}`
                      }))}
                    />
                  </Field>
                )}
                {a.mutation.kind === 'notify' && (
                  <>
                    <Field label="Title">
                      <Input
                        value={a.mutation.title}
                        onChange={(e) =>
                          a.mutation.kind === 'notify' &&
                          setAt(i, {
                            ...a,
                            mutation: {
                              kind: 'notify',
                              title: e.target.value,
                              body: a.mutation.body,
                              color: a.mutation.color
                            }
                          })
                        }
                      />
                    </Field>
                    <Field label="Body">
                      <Input
                        value={a.mutation.body}
                        onChange={(e) =>
                          a.mutation.kind === 'notify' &&
                          setAt(i, {
                            ...a,
                            mutation: {
                              kind: 'notify',
                              title: a.mutation.title,
                              body: e.target.value,
                              color: a.mutation.color
                            }
                          })
                        }
                      />
                    </Field>
                  </>
                )}
              </>
            )}
          </div>
          <Button
            size="sm"
            variant="ghost"
            icon={<Trash2 size={13} />}
            onClick={() => onChange(actions.filter((_, k) => k !== i))}
            className="shrink-0 self-start"
          />
        </div>
      ))}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[12px] text-muted">Add:</span>
        {(Object.keys(KIND_LABELS) as Action['kind'][]).map((k) => (
          <Button
            key={k}
            size="sm"
            icon={<Plus size={12} />}
            onClick={() =>
              onChange([...actions, defaultAction(k, scenes[0]?.id ?? '', layers[0]?.id ?? '')])
            }
            disabled={(k === 'activateScene' || k === 'releaseScene') && scenes.length === 0}
          >
            {KIND_LABELS[k]}
          </Button>
        ))}
      </div>
      <div className="hidden">
        <NumberInput value={0} onChange={() => undefined} />
      </div>
    </div>
  )
}
