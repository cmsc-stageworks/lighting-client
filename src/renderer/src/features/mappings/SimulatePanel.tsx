import React, { useState } from 'react'
import { FlaskConical, Zap } from 'lucide-react'
import type { SimulateReport } from '@shared/types/state'
import { ALERT_LEVELS } from '@shared/constants'
import { useConfig } from '../../store/config'
import { invoke } from '../../lib/api'
import {
  Badge,
  Button,
  Callout,
  Card,
  Checkbox,
  Field,
  Input,
  SectionTitle,
  Select,
  TextArea
} from '../../components/ui'

const PRESETS: { label: string; type: string; name: string; data: Record<string, unknown> }[] = [
  ...ALERT_LEVELS.map((l) => ({
    label: `Alert level ${l.toUpperCase()}`,
    type: 'thorium.state',
    name: 'alertLevel.changed',
    data: { level: l, rawLevel: l, training: false, previous: '5', initial: false }
  })),
  {
    label: 'Training on',
    type: 'thorium.state',
    name: 'training.changed',
    data: { training: true }
  },
  {
    label: 'Thorium action: flash',
    type: 'thorium.event',
    name: 'triggerAction',
    data: { action: 'flash', stationId: 'all' }
  },
  {
    label: 'Thorium action: blackout',
    type: 'thorium.event',
    name: 'triggerAction',
    data: { action: 'blackout', stationId: 'all' }
  },
  { label: 'Generic key', type: 'thorium.event', name: 'generic', data: { key: 'lights-test' } },
  {
    label: 'Lighting effect: shake',
    type: 'thorium.state',
    name: 'lighting.actionChanged',
    data: { action: 'shake', strength: 0.5, duration: 1000 }
  },
  {
    label: 'Battery below 25%',
    type: 'thorium.state',
    name: 'battery.below',
    data: { threshold: 0.25, level: 0.24 }
  },
  { label: 'Reactor ejected', type: 'thorium.state', name: 'reactor.ejected', data: {} },
  { label: 'Shields raised', type: 'thorium.state', name: 'shields.raised', data: { count: 1 } },
  { label: 'Flight reset', type: 'thorium.state', name: 'flight.reset', data: {} },
  {
    label: 'MQTT message',
    type: 'mqtt.message',
    name: 'cmsc/test',
    data: {
      topic: 'cmsc/test',
      topicMatch: 'cmsc/test',
      payload: '{"scene":"Flash"}',
      json: { scene: 'Flash' }
    }
  },
  { label: 'Custom event…', type: 'thorium.event', name: 'shieldRaised', data: { id: 'shield-1' } }
]

export function SimulatePanel(): React.JSX.Element {
  const profile = useConfig((s) => s.draft)!
  const [presetIdx, setPresetIdx] = useState(0)
  const [type, setType] = useState(PRESETS[0].type)
  const [name, setName] = useState(PRESETS[0].name)
  const [sim, setSim] = useState<string>(profile.simulators[0]?.name ?? '')
  const [data, setData] = useState(JSON.stringify(PRESETS[0].data, null, 2))
  const [live, setLive] = useState(false)
  const [report, setReport] = useState<SimulateReport | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const choose = (i: number): void => {
    setPresetIdx(i)
    setType(PRESETS[i].type)
    setName(PRESETS[i].name)
    setData(JSON.stringify(PRESETS[i].data, null, 2))
  }
  const run = async (): Promise<void> => {
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(data || '{}')
      setErr(null)
    } catch (e) {
      setErr(`Data is not valid JSON: ${(e as Error).message}`)
      return
    }
    setReport(
      await invoke(
        'mappings.simulate',
        { type, name, simulatorName: sim || null, data: parsed },
        live
      )
    )
  }

  return (
    <Card>
      <SectionTitle>Simulate an event</SectionTitle>
      <div className="grid grid-cols-[1fr_1fr] gap-4">
        <div className="flex flex-col gap-3">
          <Field label="Preset">
            <Select
              value={String(presetIdx)}
              onChange={(v) => choose(Number(v))}
              options={PRESETS.map((p, i) => ({ value: String(i), label: p.label }))}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type">
              <Select
                value={type}
                onChange={setType}
                options={[
                  'thorium.event',
                  'thorium.state',
                  'mqtt.message',
                  'ui.action',
                  'system'
                ].map((t) => ({ value: t, label: t }))}
              />
            </Field>
            <Field label="Name">
              <Input value={name} onChange={(e) => setName(e.target.value)} className="mono" />
            </Field>
          </div>
          <Field label="Simulator">
            <Select
              value={sim}
              onChange={setSim}
              options={[
                { value: '', label: '(none)' },
                ...profile.simulators.map((s) => ({ value: s.name, label: s.name }))
              ]}
            />
          </Field>
          <Field label="Data (JSON)" error={err}>
            <TextArea
              value={data}
              onChange={(e) => setData(e.target.value)}
              rows={5}
              className="mono"
            />
          </Field>
          <div className="flex items-center gap-3">
            <Checkbox
              checked={live}
              onChange={setLive}
              label={<span>Live — actually run the actions and send DMX</span>}
            />
            <Button
              variant={live ? 'warning' : 'primary'}
              icon={live ? <Zap size={15} /> : <FlaskConical size={15} />}
              className="ml-auto"
              onClick={() => void run()}
            >
              {live ? 'Fire for real' : 'Dry run'}
            </Button>
          </div>
        </div>
        <div>
          {!report ? (
            <div className="text-muted text-[13px] h-full flex items-center justify-center card border-dashed p-6">
              Results appear here: which mappings match and which channels would change.
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <div>
                <div className="field-label">Matched mappings</div>
                {report.matched.length === 0 ? (
                  <Callout tone="warning">
                    No mapping matched this event. Check the trigger preset, conditions and
                    simulator restriction.
                  </Callout>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {report.matched.map((m) => (
                      <li key={m.mappingId} className="card px-3 py-2 text-[13px]">
                        <div className="font-medium">{m.mappingName}</div>
                        <div className="text-muted">{m.actions.join(' → ')}</div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <div className="field-label">
                  {report.live ? 'Channels that changed' : 'Channels the scenes would set'}
                </div>
                {report.frames.length === 0 ? (
                  <div className="text-[13px] text-faint">No channel writes.</div>
                ) : (
                  report.frames.map((f, i) => (
                    <div key={i} className="text-[12px] mb-1.5">
                      <Badge tone="accent">U{f.universe}</Badge>{' '}
                      <span className="mono text-muted">
                        {f.changed
                          .slice(0, 40)
                          .map((c) => `${c.channel}=${c.value}`)
                          .join(' ')}
                        {f.changed.length > 40 ? ` … +${f.changed.length - 40}` : ''}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}
