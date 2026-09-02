import React, { useMemo, useState } from 'react'
import { AlertTriangle, Check, DownloadCloud, Plus, Ship } from 'lucide-react'
import type { SimulatorProfile } from '@shared/types/config'
import { DMX_CHANNELS } from '@shared/constants'
import { uuid } from '@shared/utils'
import { useConfig } from '../../store/config'
import { useRuntime } from '../../store/runtime'
import { SimulatorImport } from './SimulatorImport'
import {
  Badge,
  Button,
  Callout,
  Card,
  Checkbox,
  EmptyState,
  Input,
  InlineConfirm,
  Modal,
  NumberInput,
  PageHeader,
  SectionTitle,
  Tooltip
} from '../../components/ui'

export function SimulatorsPage(): React.JSX.Element {
  const profile = useConfig((s) => s.draft)
  const update = useConfig((s) => s.update)
  const snapshot = useRuntime((s) => s.snapshot)
  const [importing, setImporting] = useState(false)
  const thoriumNames = useMemo(
    () => new Set((snapshot?.thorium.simulatorsInScope ?? []).map((s) => s.name.toLowerCase())),
    [snapshot]
  )
  const refSimulators = useRuntime((s) => s.refData.simulators)
  const allThoriumNames = useMemo(() => refSimulators.map((x) => x.name), [refSimulators])

  if (!profile) return <></>
  const sims = profile.simulators
  const set = (list: SimulatorProfile[]): void => update((d) => ({ ...d, simulators: list }))
  const patch = (id: string, p: Partial<SimulatorProfile>): void =>
    set(sims.map((s) => (s.id === id ? { ...s, ...p } : s)))
  const add = (name = ''): void =>
    set([
      ...sims,
      {
        id: uuid(),
        name: name || `Simulator ${sims.length + 1}`,
        universe: profile.outputs[0]?.universe ?? 1,
        baseAddress: 1,
        color: '#4cc9f0',
        confirmed: false
      }
    ])

  // Max relative offset used by any relative scene → range width per simulator
  const maxOffset = Math.max(
    0,
    ...profile.scenes
      .filter((s) => s.addressing === 'relative')
      .flatMap((s) => s.entries.map((e) => e.channel))
  )
  const width = maxOffset + 1
  const universes = [...new Set(sims.map((s) => s.universe))].sort((a, b) => a - b)
  const overlaps = new Set<string>()
  for (const a of sims)
    for (const b of sims)
      if (
        a.id !== b.id &&
        a.universe === b.universe &&
        a.baseAddress < b.baseAddress + width &&
        b.baseAddress < a.baseAddress + width
      )
        overlaps.add(a.id)
  const unconfirmed = sims.filter((s) => !s.confirmed).length
  const missingFromThorium = allThoriumNames.filter(
    (n) => !sims.some((s) => s.name.toLowerCase() === n.toLowerCase())
  )

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader
        title="Simulators"
        subtitle="Map each Thorium simulator to the universe and base address its trigger block lives at. Relative scenes use these."
        actions={
          <>
            <Button icon={<DownloadCloud size={16} />} onClick={() => setImporting(true)}>
              Read from Thorium
            </Button>
            <Button variant="primary" icon={<Plus size={16} />} onClick={() => add()}>
              Add simulator
            </Button>
          </>
        }
      />
      {unconfirmed > 0 && (
        <Callout tone="warning" className="mb-4">
          {unconfirmed} simulator profile{unconfirmed > 1 ? 's are' : ' is'} still using placeholder
          addresses. Enter the real trigger address ranges from your lighting controller and tick
          “Confirmed”.
        </Callout>
      )}
      {missingFromThorium.length > 0 && (
        <Callout tone="info" className="mb-4 flex items-center gap-3 flex-wrap">
          <span>Thorium reports simulators with no profile here:</span>
          {missingFromThorium.map((n) => (
            <Button key={n} size="sm" icon={<Plus size={13} />} onClick={() => add(n)}>
              {n}
            </Button>
          ))}
        </Callout>
      )}
      {sims.length === 0 ? (
        <EmptyState
          icon={<Ship size={28} />}
          title="No simulator profiles"
          body="Add one per ship, or read the running flights from Thorium and let it lay the trigger blocks out for you. Names must match Thorium's simulator names (case does not matter)."
          action={
            <div className="flex items-center gap-2">
              <Button
                variant="primary"
                icon={<DownloadCloud size={16} />}
                onClick={() => setImporting(true)}
              >
                Read from Thorium
              </Button>
              <Button onClick={() => add()}>Add manually</Button>
            </div>
          }
        />
      ) : (
        <div className="card overflow-hidden mb-5">
          <table className="w-full text-[13px]">
            <thead className="bg-surface-2 text-muted text-[12px] uppercase tracking-wider">
              <tr>
                <th className="text-left font-semibold px-4 py-2.5">Name (must match Thorium)</th>
                <th className="text-left font-semibold px-3 py-2.5">Universe</th>
                <th className="text-left font-semibold px-3 py-2.5">Base address</th>
                <th className="text-left font-semibold px-3 py-2.5">Range used</th>
                <th className="text-left font-semibold px-3 py-2.5">Color</th>
                <th className="text-left font-semibold px-3 py-2.5">Status</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {sims.map((s) => {
                const seen = thoriumNames.has(s.name.toLowerCase())
                const end = s.baseAddress + width - 1
                return (
                  <tr key={s.id} className="border-t border-border">
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <Input
                          value={s.name}
                          onChange={(e) => patch(s.id, { name: e.target.value })}
                          className="!h-9 !w-52"
                          list="thorium-sim-names"
                        />
                        {seen ? (
                          <Tooltip content="Matches a simulator in the running flight">
                            <span>
                              <Badge tone="success">
                                <Check size={11} /> live
                              </Badge>
                            </span>
                          </Tooltip>
                        ) : snapshot?.thorium.state === 'connected' ? (
                          <Tooltip content="No simulator with this name in the running flight">
                            <span>
                              <Badge tone="warning">not in flight</Badge>
                            </span>
                          </Tooltip>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <NumberInput
                        value={s.universe}
                        min={1}
                        max={63999}
                        onChange={(v) => patch(s.id, { universe: v })}
                        className="!h-9 !w-24"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <NumberInput
                        value={s.baseAddress}
                        min={1}
                        max={DMX_CHANNELS}
                        onChange={(v) => patch(s.id, { baseAddress: v })}
                        className="!h-9 !w-24"
                      />
                    </td>
                    <td className="px-3 py-2 mono">
                      {s.baseAddress}–{Math.min(DMX_CHANNELS, end)}
                      {end > DMX_CHANNELS && (
                        <Tooltip
                          content={`Relative scenes reach offset ${maxOffset}, which overflows 512 for this base address`}
                        >
                          <AlertTriangle size={14} className="inline ml-1.5 text-danger" />
                        </Tooltip>
                      )}
                      {overlaps.has(s.id) && (
                        <Tooltip content="Overlaps another simulator on the same universe">
                          <AlertTriangle size={14} className="inline ml-1.5 text-warning" />
                        </Tooltip>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="color"
                        value={s.color}
                        onChange={(e) => patch(s.id, { color: e.target.value })}
                        className="w-8 h-8 rounded-md bg-transparent border-0 cursor-pointer"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Checkbox
                        checked={s.confirmed}
                        onChange={(v) => patch(s.id, { confirmed: v })}
                        label={
                          <span className={s.confirmed ? 'text-success' : 'text-warning'}>
                            {s.confirmed ? 'Confirmed' : 'Placeholder'}
                          </span>
                        }
                      />
                    </td>
                    <td className="px-4 py-2 text-right">
                      <InlineConfirm onConfirm={() => set(sims.filter((x) => x.id !== s.id))} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <datalist id="thorium-sim-names">
            {allThoriumNames.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </div>
      )}

      {sims.length > 0 && (
        <Card>
          <SectionTitle>Address map</SectionTitle>
          <div className="text-[12px] text-muted mb-3">
            Each bar is one universe (channels 1–512). Blocks show the range each simulator’s
            relative scenes occupy (widest scene offset is {maxOffset}).
          </div>
          <div className="flex flex-col gap-3">
            {universes.map((u) => (
              <div key={u}>
                <div className="flex items-center justify-between text-[12px] mb-1">
                  <span className="font-semibold">Universe {u}</span>
                  <span className="text-faint">
                    {profile.outputs.some((o) => o.enabled && o.universe === u)
                      ? 'carried by an output'
                      : 'no output carries this universe'}
                  </span>
                </div>
                <div className="relative h-8 rounded-lg bg-surface-2 border border-border overflow-hidden">
                  {sims
                    .filter((s) => s.universe === u)
                    .map((s) => (
                      <div
                        key={s.id}
                        className="absolute top-0 bottom-0 flex items-center justify-center text-[11px] font-semibold overflow-hidden whitespace-nowrap px-1"
                        style={{
                          left: `${((s.baseAddress - 1) / DMX_CHANNELS) * 100}%`,
                          width: `${(Math.min(width, DMX_CHANNELS - s.baseAddress + 1) / DMX_CHANNELS) * 100}%`,
                          background: `color-mix(in srgb, ${s.color} 45%, transparent)`,
                          borderRight: `2px solid ${s.color}`,
                          minWidth: 6
                        }}
                        title={`${s.name}: ${s.baseAddress}–${s.baseAddress + width - 1}`}
                      >
                        {width / DMX_CHANNELS > 0.06 ? s.name : ''}
                      </div>
                    ))}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
      <Modal
        open={importing}
        onClose={() => setImporting(false)}
        title="Read simulators from Thorium"
        width="max-w-3xl"
      >
        <SimulatorImport
          host={profile.thorium.host}
          port={profile.thorium.port}
          secure={profile.thorium.secure}
          existing={sims}
          onAdd={(profiles) => {
            const byName = new Map(profiles.map((p) => [p.name.toLowerCase(), p]))
            const merged = sims.map((e) => byName.get(e.name.toLowerCase()) ?? e)
            for (const p of profiles)
              if (!sims.some((e) => e.name.toLowerCase() === p.name.toLowerCase())) merged.push(p)
            set(merged)
            setImporting(false)
          }}
        />
      </Modal>
    </div>
  )
}
