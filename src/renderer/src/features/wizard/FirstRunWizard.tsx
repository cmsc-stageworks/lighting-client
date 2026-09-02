import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Check, X } from 'lucide-react'
import type { Output } from '@shared/types/config'
import type { TestReport, ThoriumTestReport } from '@shared/types/state'
import { THORIUM_DEFAULT_PORT } from '@shared/constants'
import { uuid } from '@shared/utils'
import { useConfig } from '../../store/config'
import { invoke } from '../../lib/api'
import { toast } from '../../store/toasts'
import { Button, Callout, Field, Input, NumberInput, Select, Switch } from '../../components/ui'
import { OutputForm } from '../outputs/OutputForm'
import { SimulatorImport } from '../simulators/SimulatorImport'
import { Toasts } from '../../components/ui/Toasts'

const STEPS = ['Welcome', 'Layout', 'Thorium', 'Simulators', 'DMX output', 'MQTT', 'Done'] as const

function Report({ r }: { r: TestReport }): React.JSX.Element {
  return (
    <div className="rounded-lg bg-surface-2 p-3 mt-3 flex flex-col gap-1">
      {r.steps.map((s, i) => (
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
    </div>
  )
}

export function FirstRunWizard(): React.JSX.Element {
  const nav = useNavigate()
  const draft = useConfig((s) => s.draft)
  const update = useConfig((s) => s.update)
  const save = useConfig((s) => s.save)
  const patchSettings = useConfig((s) => s.patchSettings)
  const [step, setStep] = useState(0)
  const [thTest, setThTest] = useState<ThoriumTestReport | 'running' | null>(null)
  const [outTest, setOutTest] = useState<TestReport | 'running' | null>(null)
  const [output, setOutput] = useState<Output>({
    id: uuid(),
    name: 'sACN output',
    enabled: true,
    driver: 'sacn',
    channelRange: null,
    universe: 1,
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
  const outputAdded = !!draft?.outputs.some((o) => o.id === output.id)
  const simulatorUniverses = [...new Set((draft?.simulators ?? []).map((x) => x.universe))].sort(
    (a, b) => a - b
  )

  if (!draft) return <></>
  const th = draft.thorium

  const saveAnd = async (fn?: () => Promise<void>): Promise<boolean> => {
    const ok = await save()
    if (!ok) {
      toast('error', 'Could not save: ' + useConfig.getState().errors.join('; '))
      return false
    }
    if (fn) await fn()
    return true
  }

  const next = async (): Promise<void> => {
    if (step >= 2 && step <= 5) {
      if (!(await saveAnd())) return
    }
    setStep((s) => Math.min(STEPS.length - 1, s + 1))
  }

  const finish = async (): Promise<void> => {
    if (!(await saveAnd())) return
    await patchSettings({ wizardCompleted: true })
    nav('/', { replace: true })
  }

  return (
    <div className="h-full flex items-center justify-center p-6">
      <div className="card w-full max-w-3xl p-6">
        <div className="flex items-center gap-2 mb-6">
          {STEPS.map((s, i) => (
            <React.Fragment key={s}>
              <div
                className={`flex items-center gap-1.5 text-[12px] font-semibold ${i === step ? 'text-accent' : i < step ? 'text-success' : 'text-faint'}`}
              >
                <span
                  className={`w-5 h-5 rounded-full flex items-center justify-center border ${i === step ? 'border-accent' : i < step ? 'border-success bg-success/15' : 'border-border'}`}
                >
                  {i < step ? <Check size={11} /> : i + 1}
                </span>
                {s}
              </div>
              {i < STEPS.length - 1 && <div className="grow h-px bg-border" />}
            </React.Fragment>
          ))}
        </div>

        {step === 0 && (
          <div>
            <h1 className="text-2xl font-semibold mb-2">Welcome to the CMSC Lighting Client</h1>
            <p className="text-muted mb-4">
              This wizard connects the app to Thorium, adds your first DMX output and optionally
              MQTT. Everything can be changed later under Setup.
            </p>
            <ul className="text-[14px] flex flex-col gap-1.5 list-disc pl-5 text-muted">
              <li>
                Thorium events (alert levels, macros, timeline items…) become lighting scenes
                through Mappings.
              </li>
              <li>
                Scenes are raw DMX channel values, sent to your lighting controller over sACN or to
                an Enttec USB DMX Pro.
              </li>
            </ul>
          </div>
        )}

        {step === 1 && (
          <div>
            <h2 className="text-xl font-semibold mb-1">How will this machine be used?</h2>
            <p className="text-muted mb-4">Both layouts work; this only sets sensible defaults.</p>
            <div className="grid grid-cols-2 gap-3">
              {(['central', 'single-ship'] as const).map((k) => (
                <button
                  key={k}
                  onClick={() =>
                    update((d) => ({
                      ...d,
                      kind: k,
                      name:
                        k === 'central' ? 'Central' : d.name === 'Central' ? 'Single ship' : d.name,
                      thorium: {
                        ...d.thorium,
                        scope: k === 'central' ? { mode: 'all' } : { mode: 'follow-assignment' }
                      }
                    }))
                  }
                  className={`text-left card p-4 ${draft.kind === k ? 'border-accent ring-1 ring-accent' : 'hover:bg-surface-2'}`}
                >
                  <div className="font-semibold">
                    {k === 'central' ? 'Central lighting computer' : 'One ship’s computer'}
                  </div>
                  <div className="text-[13px] text-muted mt-1">
                    {k === 'central'
                      ? 'Follows every simulator in the running flights and drives all of their universes from one machine.'
                      : 'Does nothing until the Flight Director assigns this client to the room’s flight and simulator, then follows that only. Survives clean-slate flight changes.'}
                  </div>
                </button>
              ))}
            </div>
            <Field label="Profile name" className="mt-4">
              <Input
                value={draft.name}
                onChange={(e) => update((d) => ({ ...d, name: e.target.value }))}
              />
            </Field>
          </div>
        )}

        {step === 2 && (
          <div>
            <h2 className="text-xl font-semibold mb-1">Connect to Thorium</h2>
            <p className="text-muted mb-4">
              The app registers as a client named “{th.clientLabel}”. Production Thorium listens on
              port {THORIUM_DEFAULT_PORT}.
            </p>
            <div className="grid grid-cols-[1fr_120px_auto] gap-3 items-end">
              <Field label="Host">
                <Input
                  value={th.host}
                  onChange={(e) =>
                    update((d) => ({ ...d, thorium: { ...d.thorium, host: e.target.value } }))
                  }
                />
              </Field>
              <Field label="Port">
                <NumberInput
                  value={th.port}
                  min={1}
                  max={65535}
                  onChange={(v) => update((d) => ({ ...d, thorium: { ...d.thorium, port: v } }))}
                />
              </Field>
              <div className="pb-0.5">
                <Switch
                  checked={th.enabled}
                  onChange={(v) => update((d) => ({ ...d, thorium: { ...d.thorium, enabled: v } }))}
                  label="Enabled"
                />
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <Button
                loading={thTest === 'running'}
                onClick={() =>
                  void saveAnd(async () => {
                    setThTest('running')
                    setThTest(await invoke('thorium.test'))
                  })
                }
              >
                Save & test connection
              </Button>
              <span className="text-[12px] text-muted">Testing saves the profile first.</span>
            </div>
            {thTest && thTest !== 'running' && <Report r={thTest} />}
            {!th.enabled && (
              <Callout tone="muted" className="mt-3">
                Thorium is off. You can still use MQTT and Dashboard buttons.
              </Callout>
            )}
          </div>
        )}

        {step === 3 && (
          <div>
            <h2 className="text-xl font-semibold mb-1">Which ships does this instance light?</h2>
            <p className="text-muted mb-4">
              Each simulator gets a universe and a block of DMX channels; relative scenes are
              written as offsets inside that block, so one scene works for every ship. Read the
              running flights from Thorium to fill this in, or add ships by name.
            </p>
            <SimulatorImport
              host={draft.thorium.host}
              port={draft.thorium.port}
              secure={draft.thorium.secure}
              existing={draft.simulators}
              onAdd={(profiles) => {
                update((d) => {
                  const byName = new Map(profiles.map((p) => [p.name.toLowerCase(), p]))
                  const merged = d.simulators.map((e) => byName.get(e.name.toLowerCase()) ?? e)
                  for (const p of profiles)
                    if (!d.simulators.some((e) => e.name.toLowerCase() === p.name.toLowerCase()))
                      merged.push(p)
                  return { ...d, simulators: merged }
                })
                toast('success', `Added ${profiles.length} simulator(s)`)
              }}
            />
            {draft.simulators.length > 0 && (
              <div className="mt-4">
                <div className="field-label">Configured</div>
                <div className="flex flex-wrap gap-2">
                  {draft.simulators.map((sim) => (
                    <span
                      key={sim.id}
                      className="h-8 px-3 rounded-full bg-surface-2 border border-border text-[13px] inline-flex items-center gap-2"
                    >
                      <span
                        className="w-2.5 h-2.5 rounded-full"
                        style={{ background: sim.color }}
                      />
                      {sim.name}
                      <span className="text-faint mono">
                        U{sim.universe} @{sim.baseAddress}
                      </span>
                    </span>
                  ))}
                </div>
                <div className="text-[12px] text-faint mt-2">
                  Addresses can be changed any time on the Simulators page; mark them confirmed once
                  they match your controller.
                </div>
              </div>
            )}
          </div>
        )}

        {step === 4 && (
          <div>
            <h2 className="text-xl font-semibold mb-1">First DMX output</h2>
            <p className="text-muted mb-4">
              Send DMX to your lighting controller over sACN, or to an Enttec USB DMX Pro. Add one
              now; more can be added later.
            </p>
            <OutputForm output={output} onChange={setOutput} />
            <div className="mt-3 flex items-center gap-2">
              {!outputAdded ? (
                <Button
                  variant="primary"
                  onClick={() => {
                    update((d) => ({
                      ...d,
                      outputs: [...d.outputs.filter((o) => o.id !== output.id), output]
                    }))
                  }}
                  disabled={!output.name.trim()}
                >
                  Add this output
                </Button>
              ) : (
                <>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      update((d) => ({
                        ...d,
                        outputs: d.outputs.map((o) => (o.id === output.id ? output : o))
                      }))
                    }}
                  >
                    Update output
                  </Button>
                  <Button
                    loading={outTest === 'running'}
                    onClick={() =>
                      void saveAnd(async () => {
                        setOutTest('running')
                        setOutTest(await invoke('outputs.test', output.id))
                      })
                    }
                  >
                    Save & send test frames
                  </Button>
                </>
              )}
              {simulatorUniverses.length > 0 && (
                <Select
                  value={String(output.universe)}
                  onChange={(v) =>
                    setOutput({ ...output, universe: Number(v), name: `sACN universe ${v}` })
                  }
                  options={simulatorUniverses.map((u) => ({
                    value: String(u),
                    label: `Universe ${u} (${draft.simulators
                      .filter((x) => x.universe === u)
                      .map((x) => x.name)
                      .join(', ')})`
                  }))}
                  className="ml-auto w-72"
                />
              )}
            </div>
            {outTest && outTest !== 'running' && <Report r={outTest} />}
          </div>
        )}

        {step === 5 && (
          <div>
            <h2 className="text-xl font-semibold mb-1">MQTT (optional)</h2>
            <p className="text-muted mb-4">
              If you have a broker, enter it now. The app subscribes to your topics and publishes
              its own status under <span className="mono">cmsc/lighting/&lt;instance&gt;</span>.
            </p>
            <div className="grid grid-cols-[1fr_auto] gap-3 items-end">
              <Field label="Broker URL">
                <Input
                  value={draft.mqtt.url}
                  onChange={(e) =>
                    update((d) => ({ ...d, mqtt: { ...d.mqtt, url: e.target.value } }))
                  }
                  className="mono"
                />
              </Field>
              <div className="pb-0.5">
                <Switch
                  checked={draft.mqtt.enabled}
                  onChange={(v) => update((d) => ({ ...d, mqtt: { ...d.mqtt, enabled: v } }))}
                  label="Enabled"
                />
              </div>
            </div>
            <Callout tone="muted" className="mt-3">
              Username, password and subscriptions are on the MQTT setup page.
            </Callout>
          </div>
        )}

        {step === 6 && (
          <div>
            <h2 className="text-xl font-semibold mb-1">You’re set</h2>
            <p className="text-muted mb-4">
              Seeded scenes and mappings map alert levels 5→1 and P to placeholder trigger channels.
              Next steps:
            </p>
            <ol className="list-decimal pl-5 flex flex-col gap-1.5 text-[14px]">
              <li>
                Open <b>Simulators</b> and enter the real controller address ranges, then tick
                Confirmed.
              </li>
              <li>
                Open <b>Scenes</b> and set the channels for each alert level.
              </li>
              <li>
                Change the alert level in Thorium and watch the <b>Universe monitor</b> on the
                Outputs page.
              </li>
            </ol>
          </div>
        )}

        <div className="flex items-center justify-between mt-6 pt-4 border-t border-border">
          <Button
            variant="ghost"
            icon={<ArrowLeft size={16} />}
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
          >
            Back
          </Button>
          <div className="flex items-center gap-2">
            {step < STEPS.length - 1 && step > 0 && (
              <Button variant="ghost" onClick={() => void finish()}>
                Skip the rest
              </Button>
            )}
            {step < STEPS.length - 1 ? (
              <Button variant="primary" icon={<ArrowRight size={16} />} onClick={() => void next()}>
                Continue
              </Button>
            ) : (
              <Button variant="primary" icon={<Check size={16} />} onClick={() => void finish()}>
                Open the Dashboard
              </Button>
            )}
          </div>
        </div>
      </div>
      <Toasts />
    </div>
  )
}
