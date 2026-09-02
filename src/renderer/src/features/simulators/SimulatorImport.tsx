import React, { useMemo, useState } from 'react'
import clsx from 'clsx'
import { AlertTriangle, Check, DownloadCloud, Plus, Ship } from 'lucide-react'
import type { SimulatorProfile } from '@shared/types/config'
import type { ThoriumProbeResult } from '@shared/types/state'
import { DEFAULT_LAYOUT, planSimulatorLayout, toSimulatorProfiles } from '@shared/simulatorLayout'
import { eqIgnoreCase } from '@shared/utils'
import { invoke } from '../../lib/api'
import { Badge, Button, Callout, Field, Input, NumberInput, Select } from '../../components/ui'

/**
 * Reads the running flights from a Thorium server and turns the simulators it reports
 * into simulator profiles, laying their trigger blocks out across universes/addresses.
 * Shared by the first-run wizard and the Simulators page.
 */
export function SimulatorImport({
  host,
  port,
  secure,
  existing,
  onAdd
}: {
  host: string
  port: number
  secure: boolean
  existing: SimulatorProfile[]
  onAdd: (profiles: SimulatorProfile[]) => void
}): React.JSX.Element {
  const [probe, setProbe] = useState<ThoriumProbeResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [layout, setLayout] = useState({ ...DEFAULT_LAYOUT })
  const [manual, setManual] = useState('')

  const fetchNow = async (): Promise<void> => {
    setLoading(true)
    try {
      const r = await invoke('thorium.probe', host, port, secure)
      setProbe(r)
      if (r.ok) {
        const names: string[] = []
        for (const f of r.flights)
          for (const s of f.simulators)
            if (!names.some((n) => eqIgnoreCase(n, s.name))) names.push(s.name)
        setSelected(names)
      }
    } finally {
      setLoading(false)
    }
  }
  const discovered = useMemo(() => {
    const names: string[] = []
    for (const f of probe?.flights ?? [])
      for (const s of f.simulators)
        if (!names.some((n) => eqIgnoreCase(n, s.name))) names.push(s.name)
    for (const n of selected) if (!names.some((x) => eqIgnoreCase(x, n))) names.push(n)
    return names
  }, [probe, selected])

  const plan = useMemo(
    () => planSimulatorLayout(selected, layout, existing.length),
    [selected, layout, existing.length]
  )
  const overflow = plan.some((p) => p.overflow)
  const toggle = (n: string): void =>
    setSelected(
      selected.some((x) => eqIgnoreCase(x, n))
        ? selected.filter((x) => !eqIgnoreCase(x, n))
        : [...selected, n]
    )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Button
          variant="primary"
          icon={<DownloadCloud size={15} />}
          loading={loading}
          onClick={() => void fetchNow()}
        >
          Read simulators from Thorium
        </Button>
        <span className="text-[13px] text-muted">
          {host}:{port}
        </span>
        {probe && !probe.ok && <Badge tone="danger">Could not reach Thorium: {probe.error}</Badge>}
        {probe?.ok && (
          <Badge tone="success">
            <Check size={11} /> Connected · {probe.flights.length} flight(s),{' '}
            {probe.flights.filter((f) => f.running).length} running
          </Badge>
        )}
      </div>

      {probe?.ok && probe.flights.length === 0 && (
        <Callout tone="warning">
          Thorium answered but has no flights yet, so it reports no simulators. Create a flight and
          read again, or add simulators by name below.
        </Callout>
      )}

      {probe?.ok &&
        probe.flights.map((f) => (
          <div key={f.id}>
            <div className="field-label flex items-center gap-2">
              {f.name || f.id}
              <span className="text-faint normal-case tracking-normal font-normal">
                {f.running ? 'running' : 'paused'}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {f.simulators.map((s) => {
                const on = selected.some((x) => eqIgnoreCase(x, s.name))
                return (
                  <button
                    key={s.id}
                    onClick={() => toggle(s.name)}
                    className={clsx(
                      'h-9 px-3.5 rounded-full border text-[13px] font-medium inline-flex items-center gap-1.5',
                      on
                        ? 'bg-accent/20 text-accent border-accent/40'
                        : 'bg-surface-2 text-muted border-border hover:text-text'
                    )}
                  >
                    <Ship size={14} /> {s.name}
                    {existing.some((e) => eqIgnoreCase(e.name, s.name)) && (
                      <span className="text-faint">· exists</span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        ))}

      <div className="flex items-end gap-2">
        <Field
          label="Add a simulator by name"
          className="grow"
          hint="Must match the name in Thorium"
        >
          <Input
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && manual.trim()) {
                toggle(manual.trim())
                setManual('')
              }
            }}
            placeholder="Ship name"
            list="discovered-simulators"
          />
          <datalist id="discovered-simulators">
            {discovered.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </Field>
        <Button
          icon={<Plus size={15} />}
          className="mb-5"
          disabled={!manual.trim()}
          onClick={() => {
            toggle(manual.trim())
            setManual('')
          }}
        >
          Add
        </Button>
      </div>

      {selected.length > 0 && (
        <>
          <div className="grid grid-cols-4 gap-3">
            <Field label="First universe">
              <NumberInput
                value={layout.startUniverse}
                min={1}
                max={63999}
                onChange={(v) => setLayout({ ...layout, startUniverse: v })}
              />
            </Field>
            <Field label="First address">
              <NumberInput
                value={layout.startAddress}
                min={1}
                max={512}
                onChange={(v) => setLayout({ ...layout, startAddress: v })}
              />
            </Field>
            <Field label="Channels per simulator" hint="Block size">
              <NumberInput
                value={layout.blockSize}
                min={1}
                max={512}
                onChange={(v) => setLayout({ ...layout, blockSize: v })}
              />
            </Field>
            <Field label="Simulators per universe">
              <Select
                value={String(layout.perUniverse)}
                onChange={(v) => setLayout({ ...layout, perUniverse: Number(v) })}
                options={[
                  { value: '0', label: 'All on one universe' },
                  ...[1, 2, 3, 4, 6, 8].map((n) => ({
                    value: String(n),
                    label: `${n} per universe`
                  }))
                ]}
              />
            </Field>
          </div>

          <div className="card overflow-hidden">
            <table className="w-full text-[13px]">
              <thead className="bg-surface-2 text-muted text-[12px] uppercase tracking-wider">
                <tr>
                  <th className="text-left font-semibold px-3 py-2">Simulator</th>
                  <th className="text-left font-semibold px-3 py-2">Universe</th>
                  <th className="text-left font-semibold px-3 py-2">Channels</th>
                  <th className="text-left font-semibold px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {plan.map((p) => (
                  <tr key={p.name} className="border-t border-border">
                    <td className="px-3 py-1.5">
                      <span className="inline-flex items-center gap-2">
                        <span className="w-3 h-3 rounded-full" style={{ background: p.color }} />
                        {p.name}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 mono">{p.universe}</td>
                    <td className="px-3 py-1.5 mono">
                      {p.baseAddress}–{p.baseAddress + layout.blockSize - 1}
                    </td>
                    <td className="px-3 py-1.5">
                      {p.overflow ? (
                        <Badge tone="danger">
                          <AlertTriangle size={11} /> past 512
                        </Badge>
                      ) : existing.some((e) => eqIgnoreCase(e.name, p.name)) ? (
                        <Badge tone="warning">replaces existing</Badge>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {overflow && (
            <Callout tone="danger">
              Some blocks run past channel 512. Reduce the block size, or put fewer simulators on
              each universe.
            </Callout>
          )}

          <div>
            <Button
              variant="primary"
              icon={<Plus size={16} />}
              disabled={overflow}
              onClick={() => onAdd(toSimulatorProfiles(plan, existing))}
            >
              Add {plan.length} simulator{plan.length === 1 ? '' : 's'}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
