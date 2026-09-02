import React, { useEffect, useMemo, useState } from 'react'
import { Radio, Send, Square, Sun } from 'lucide-react'
import { DMX_CHANNELS } from '@shared/constants'
import { invoke, on } from '../../lib/api'
import { useConfig } from '../../store/config'
import { useRuntime } from '../../store/runtime'
import {
  Button,
  Callout,
  Card,
  Field,
  NumberInput,
  SectionTitle,
  Select,
  Slider,
  Switch
} from '../../components/ui'
import { ChannelGrid } from '../scenes/ChannelGrid'

export function UniverseMonitor(): React.JSX.Element {
  const profile = useConfig((s) => s.draft)!
  const snapshot = useRuntime((s) => s.snapshot)
  const universesRaw = snapshot?.compositor.universes
  const universes = useMemo(() => universesRaw ?? [], [universesRaw])
  const [universeSel, setUniverse] = useState<number>(
    universes[0] ?? profile.outputs[0]?.universe ?? 1
  )
  // If the selected universe disappears (output removed), follow the first carried one.
  const universe = universes.length && !universes.includes(universeSel) ? universes[0] : universeSel
  const [frame, setFrame] = useState<{ values: number[]; owners: (string | null)[] }>({
    values: new Array(DMX_CHANNELS).fill(0),
    owners: new Array(DMX_CHANNELS).fill(null)
  })
  const [compact, setCompact] = useState(false)
  const [gm, setGm] = useState<number | null>(null)
  const grandMaster = gm ?? snapshot?.compositor.grandMaster ?? 1

  useEffect(() => {
    void invoke('dmx.subscribeUniverse', universe, true)
    void invoke('dmx.getFrame', universe).then(setFrame)
    const off = on('dmx:frame', (f) => {
      if (f.universe === universe) setFrame({ values: f.values, owners: f.owners })
    })
    return () => {
      off()
      void invoke('dmx.subscribeUniverse', universe, false)
    }
  }, [universe])

  const ownerName = (id: string | null): string | null => {
    if (!id) return null
    if (id === 'test') return 'Channel tester'
    const a = snapshot?.compositor.active.find((x) => x.instanceId === id)
    return a ? `${a.sceneName}${a.simulatorName ? ' · ' + a.simulatorName : ''}` : id
  }
  const owners = frame.owners.map(ownerName)
  const nonZero = frame.values.filter((v) => v > 0).length
  const ranges = profile.simulators
    .filter((s) => s.universe === universe)
    .map((s) => ({
      from: s.baseAddress,
      to: Math.min(512, s.baseAddress + 49),
      color: s.color,
      label: s.name
    }))
  const carried = profile.outputs.filter((o) => o.enabled && o.universe === universe)

  return (
    <Card>
      <SectionTitle
        action={
          <div className="flex items-center gap-3">
            <Switch checked={compact} onChange={setCompact} label="Compact" />
            <Select
              value={String(universe)}
              onChange={(v) => setUniverse(Number(v))}
              options={(universes.length ? universes : [universe]).map((u) => ({
                value: String(u),
                label: `Universe ${u}`
              }))}
              className="w-40"
            />
          </div>
        }
      >
        Universe monitor
      </SectionTitle>
      <div className="flex items-center gap-4 text-[12px] text-muted mb-3">
        <span>
          <b className="text-text mono">{nonZero}</b> channels above 0
        </span>
        <span>
          {carried.length
            ? `Sent by ${carried.map((o) => o.name).join(', ')}`
            : 'Not carried by any enabled output'}
        </span>
        {snapshot?.compositor.blackout && (
          <span className="text-danger font-semibold">BLACKOUT</span>
        )}
        <span className="ml-auto flex items-center gap-2 w-72">
          <Sun size={13} />
          <span className="whitespace-nowrap">Grand master</span>
          <Slider
            className="grow"
            value={Math.round(grandMaster * 100)}
            onChange={(v) => setGm(v / 100)}
            onCommit={(v) =>
              void invoke('compositor.setGrandMaster', v / 100).then(() => setGm(null))
            }
          />
          <span className="mono w-10 text-right">{Math.round(grandMaster * 100)}%</span>
        </span>
      </div>
      {grandMaster < 1 && (
        <Callout tone="warning" className="mb-3">
          Grand master is at {Math.round(grandMaster * 100)}%: every transmitted channel is scaled
          down. On a trigger universe this can push values below the controller&apos;s threshold.
        </Callout>
      )}
      <ChannelGrid
        values={frame.values}
        owners={owners}
        readOnly
        highlightRange={ranges}
        compact={compact}
      />
      <div className="text-[12px] text-faint mt-2">
        Hover a cell to see which scene owns it. Cells flash when they change.
      </div>
    </Card>
  )
}

export function ChannelTester(): React.JSX.Element {
  const profile = useConfig((s) => s.draft)!
  const snapshot = useRuntime((s) => s.snapshot)
  const universes = snapshot?.compositor.universes ?? []
  const [universe, setUniverse] = useState<number>(
    universes[0] ?? profile.outputs[0]?.universe ?? 1
  )
  const [channel, setChannel] = useState(1)
  const [value, setValue] = useState(255)
  const [holding, setHolding] = useState(false)

  useEffect(() => () => void invoke('dmx.clearTest'), [])
  useEffect(() => {
    if (holding) void invoke('dmx.setTestChannel', universe, channel, value)
    // Re-target when the universe or channel changes mid-hold.
  }, [universe, channel, holding, value])

  /** Change the value, and push it immediately when the channel is being held. */
  const setVal = (v: number): void => {
    setValue(v)
    if (holding) void invoke('dmx.setTestChannel', universe, channel, v)
  }
  const send = (v: number): void => {
    setHolding(true)
    void invoke('dmx.setTestChannel', universe, channel, v)
  }
  const release = (): void => {
    setHolding(false)
    void invoke('dmx.clearTest')
  }
  const pulse = async (): Promise<void> => {
    send(value)
    await new Promise((r) => setTimeout(r, 500))
    release()
  }

  return (
    <Card>
      <SectionTitle>Channel tester</SectionTitle>
      <div className="grid grid-cols-[140px_120px_1fr] gap-4 items-end">
        <Field label="Universe">
          <Select
            value={String(universe)}
            onChange={(v) => setUniverse(Number(v))}
            options={(universes.length ? universes : [universe]).map((u) => ({
              value: String(u),
              label: `U ${u}`
            }))}
          />
        </Field>
        <Field label="Channel">
          <NumberInput value={channel} min={1} max={DMX_CHANNELS} onChange={setChannel} />
        </Field>
        <Field label="Value">
          <div className="h-10 flex items-center gap-3">
            <Slider value={value} min={0} max={255} onChange={setVal} className="grow" />
            <NumberInput value={value} min={0} max={255} onChange={setVal} className="!w-20" />
            {[0, 128, 255].map((v) => (
              <Button
                key={v}
                size="sm"
                variant={value === v ? 'primary' : 'secondary'}
                onClick={() => setVal(v)}
              >
                {v}
              </Button>
            ))}
          </div>
        </Field>
      </div>
      <div className="flex items-center gap-2 mt-4">
        <Button variant="primary" icon={<Send size={15} />} onClick={() => void pulse()}>
          Pulse 0.5 s
        </Button>
        <Button
          variant={holding ? 'warning' : 'secondary'}
          icon={<Radio size={15} />}
          onClick={() => (holding ? release() : send(value))}
        >
          {holding ? 'Holding — click to release' : 'Hold'}
        </Button>
        <Button icon={<Square size={15} />} onClick={release} disabled={!holding}>
          Release
        </Button>
        <span className="text-[12px] text-muted ml-auto">
          Uses the Test layer (priority 90) so it shows over any scene.
        </span>
      </div>
      {universes.length === 0 && (
        <Callout tone="warning" className="mt-3">
          No enabled outputs. The tester will composite but nothing is sent.
        </Callout>
      )}
    </Card>
  )
}
