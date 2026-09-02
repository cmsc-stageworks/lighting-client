import React, { useState } from 'react'
import { Cable, Check, FlaskConical, Lightbulb, Pencil, Plus, RotateCw, X } from 'lucide-react'
import type { Output } from '@shared/types/config'
import type { TestReport } from '@shared/types/state'
import { uuid } from '@shared/utils'
import { useConfig } from '../../store/config'
import { useRuntime } from '../../store/runtime'
import { invoke } from '../../lib/api'
import { toast } from '../../store/toasts'
import { formatAgo, outputLabel, outputTone } from '../../lib/format'
import {
  Badge,
  Button,
  Callout,
  EmptyState,
  InlineConfirm,
  Modal,
  NumberInput,
  PageHeader,
  SectionTitle,
  Pill,
  Tabs
} from '../../components/ui'
import { OutputForm } from './OutputForm'
import { ChannelTester, UniverseMonitor } from './UniverseMonitor'

function TestResult({ report }: { report: TestReport }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      {report.steps.map((s, i) => (
        <div key={i} className="flex items-start gap-2 text-[13px]">
          {s.ok ? (
            <Check size={15} className="text-success mt-0.5 shrink-0" />
          ) : (
            <X size={15} className="text-danger mt-0.5 shrink-0" />
          )}
          <span>
            <span className="font-medium">{s.name}</span>
            {s.detail && <span className="text-muted"> — {s.detail}</span>}
          </span>
        </div>
      ))}
      <div className="text-[12px] text-faint">{report.durationMs} ms</div>
    </div>
  )
}

export function OutputsPage(): React.JSX.Element {
  const profile = useConfig((s) => s.draft)
  const update = useConfig((s) => s.update)
  const dirty = useConfig((s) => s.dirty)
  const snapshot = useRuntime((s) => s.snapshot)
  const [editing, setEditing] = useState<Output | null>(null)
  const [tests, setTests] = useState<Record<string, TestReport | 'running'>>({})
  const [identify, setIdentify] = useState<Record<string, number>>({})
  const [tab, setTab] = useState('monitor')
  if (!profile) return <></>

  const add = (): void =>
    setEditing({
      id: uuid(),
      name: `Universe ${profile.outputs.length ? profile.outputs[profile.outputs.length - 1].universe + 1 : 10}`,
      enabled: true,
      driver: 'sacn',
      channelRange: null,
      universe: profile.outputs.length
        ? profile.outputs[profile.outputs.length - 1].universe + 1
        : 10,
      sacn: {
        mode: 'multicast',
        unicastAddress: null,
        priority: 100,
        sourceName: 'CMSC Lighting Client',
        iface: null,
        fps: 40,
        keepAliveMs: 800
      }
    })
  const commit = (): void => {
    if (!editing) return
    update((d) => ({
      ...d,
      outputs: d.outputs.some((o) => o.id === editing.id)
        ? d.outputs.map((o) => (o.id === editing.id ? editing : o))
        : [...d.outputs, editing]
    }))
    setEditing(null)
  }
  const remove = (o: Output): void => {
    const idx = profile.outputs.findIndex((x) => x.id === o.id)
    update((d) => ({ ...d, outputs: d.outputs.filter((x) => x.id !== o.id) }))
    toast('info', `Removed "${o.name}"`, () =>
      update((d) => ({ ...d, outputs: [...d.outputs.slice(0, idx), o, ...d.outputs.slice(idx)] }))
    )
  }
  const runTest = async (o: Output): Promise<void> => {
    setTests((t) => ({ ...t, [o.id]: 'running' }))
    const r = await invoke('outputs.test', o.id)
    setTests((t) => ({ ...t, [o.id]: r }))
  }

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        title="Outputs"
        subtitle="Where DMX frames go. Several outputs may carry the same universe."
        actions={
          <Button variant="primary" icon={<Plus size={16} />} onClick={add}>
            Add output
          </Button>
        }
      />
      {dirty && (
        <Callout tone="warning" className="mb-4">
          Output changes apply after you save (⌘S / Ctrl+S).
        </Callout>
      )}

      {profile.outputs.length === 0 ? (
        <EmptyState
          icon={<Cable size={28} />}
          title="No outputs yet"
          body="Add an sACN universe for your lighting controller, or an Enttec USB DMX Pro."
          action={
            <Button variant="primary" icon={<Plus size={16} />} onClick={add}>
              Add an sACN output
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(340px,1fr))] gap-4">
          {profile.outputs.map((o) => {
            const h = snapshot?.outputs[o.id]
            const st = o.enabled ? (h?.state ?? 'starting') : 'disabled'
            const t = tests[o.id]
            return (
              <div key={o.id} className="card p-4 flex flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{o.name}</div>
                    <div className="text-[12px] text-muted">
                      {o.driver === 'sacn'
                        ? `sACN · U${o.universe} · ${o.sacn.mode}${o.sacn.mode === 'unicast' ? ' → ' + o.sacn.unicastAddress : ''} · prio ${o.sacn.priority}`
                        : `Enttec Pro · U${o.universe} · ${o.enttec.serialNumber ? 'SN ' + o.enttec.serialNumber : o.enttec.portPath || 'no port'}`}
                    </div>
                  </div>
                  <Pill tone={outputTone(st)} pulse={st === 'starting'}>
                    {outputLabel(st)}
                  </Pill>
                </div>
                {h?.reason && st === 'error' && (
                  <div className="text-danger text-[13px]">{h.reason}</div>
                )}
                <div className="grid grid-cols-3 gap-2 text-[12px]">
                  <div>
                    <div className="text-faint">Rate</div>
                    <div className="mono">{h?.fps ?? 0} fps</div>
                  </div>
                  <div>
                    <div className="text-faint">Last send</div>
                    <div>{formatAgo(h?.lastSendAt)}</div>
                  </div>
                  <div className="min-w-0">
                    <div className="text-faint">Target</div>
                    <div className="truncate" title={h?.detail}>
                      {h?.detail ?? '—'}
                    </div>
                  </div>
                </div>
                {t && t !== 'running' && (
                  <div className="rounded-lg bg-surface-2 p-3">
                    <div className="flex items-center gap-2 mb-1.5">
                      <Badge tone={t.ok ? 'success' : 'danger'}>{t.ok ? 'PASS' : 'FAIL'}</Badge>
                      <button
                        className="text-faint text-[12px] ml-auto"
                        onClick={() =>
                          setTests((x) => ({ ...x, [o.id]: undefined as unknown as TestReport }))
                        }
                      >
                        dismiss
                      </button>
                    </div>
                    <TestResult report={t} />
                  </div>
                )}
                <div className="flex items-center gap-1.5 flex-wrap mt-auto">
                  <Button
                    size="sm"
                    icon={<FlaskConical size={13} />}
                    loading={t === 'running'}
                    onClick={() => void runTest(o)}
                    disabled={dirty}
                  >
                    Run test
                  </Button>
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      icon={<Lightbulb size={13} />}
                      onClick={() => void invoke('outputs.identify', o.id, identify[o.id] ?? 1)}
                      disabled={st !== 'ok'}
                    >
                      Identify ch
                    </Button>
                    <NumberInput
                      value={identify[o.id] ?? 1}
                      min={1}
                      max={512}
                      onChange={(v) => setIdentify((x) => ({ ...x, [o.id]: v }))}
                      className="!w-16 !h-8 !py-0"
                    />
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<RotateCw size={13} />}
                    onClick={() => void invoke('outputs.restart', o.id)}
                    disabled={!o.enabled}
                  />
                  <span className="ml-auto flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<Pencil size={13} />}
                      onClick={() => setEditing(o)}
                    />
                    <InlineConfirm onConfirm={() => remove(o)} label="Remove" />
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="mt-8 pt-6 border-t border-border">
        <SectionTitle className="!mb-4">Live output</SectionTitle>
        <Tabs
          className="mb-4"
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'monitor', label: 'Universe monitor' },
            { value: 'tester', label: 'Channel tester' }
          ]}
        />
        {tab === 'monitor' ? <UniverseMonitor /> : <ChannelTester />}
      </div>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={profile.outputs.some((o) => o.id === editing?.id) ? 'Edit output' : 'New output'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={commit} disabled={!editing?.name.trim()}>
              Done
            </Button>
          </>
        }
      >
        {editing && <OutputForm output={editing} onChange={setEditing} />}
      </Modal>
    </div>
  )
}
