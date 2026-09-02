import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import * as Popover from '@radix-ui/react-popover'
import { Cable, Radio, Rocket, Sun } from 'lucide-react'
import { useRuntime } from '../../store/runtime'
import { useConfig } from '../../store/config'
import {
  connLabel,
  connTone,
  formatAgo,
  outputLabel,
  outputTone,
  type Tone
} from '../../lib/format'
import { Button, KeyValue, Pill } from '../ui'
import { invoke } from '../../lib/api'

function StatusPopover({
  tone,
  label,
  icon,
  title,
  items,
  fixTo,
  actions
}: {
  tone: Tone
  label: string
  icon: React.ReactNode
  title: string
  items: { k: string; v: React.ReactNode }[]
  fixTo: string
  actions?: React.ReactNode
}): React.JSX.Element {
  const nav = useNavigate()
  const [open, setOpen] = useState(false)
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button className="rounded-full focus-visible:outline-none">
          <Pill
            tone={tone}
            pulse={tone === 'warning'}
            className="cursor-pointer hover:brightness-110"
          >
            {icon}
            {label}
          </Pill>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content sideOffset={8} align="start" className="z-50 w-80 card p-4 shadow-2xl">
          <div className="font-semibold mb-2">{title}</div>
          <KeyValue items={items} />
          <div className="flex items-center gap-2 mt-3">
            {actions}
            <Button
              size="sm"
              variant="primary"
              className="ml-auto"
              onClick={() => {
                setOpen(false)
                nav(fixTo)
              }}
            >
              Open settings
            </Button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

export function StatusBar(): React.JSX.Element {
  const snap = useRuntime((s) => s.snapshot)
  const profile = useConfig((s) => s.draft)
  if (!snap || !profile) return <div className="h-12 border-b border-border bg-surface" />
  const th = snap.thorium
  const mq = snap.mqtt
  const outputs = profile.outputs
  return (
    <div className="h-12 shrink-0 border-b border-border bg-surface flex items-center gap-2 px-4 overflow-x-auto">
      <StatusPopover
        tone={
          !profile.thorium.enabled
            ? 'muted'
            : th.state === 'connected' && th.waitingForAssignment
              ? 'warning'
              : connTone(th.state)
        }
        label={`Thorium · ${!profile.thorium.enabled ? 'Off' : th.state === 'connected' && th.waitingForAssignment ? 'Not assigned' : connLabel(th.state)}`}
        icon={<Rocket size={13} />}
        title="Thorium"
        fixTo="/setup/thorium"
        items={[
          { k: 'Server', v: `${profile.thorium.host}:${profile.thorium.port}` },
          {
            k: 'State',
            v: th.reason ? `${connLabel(th.state)} — ${th.reason}` : connLabel(th.state)
          },
          { k: 'Server id', v: th.serverId ?? '—' },
          {
            k: 'Assigned flight',
            v: th.flight
              ? `${th.flight.name}${th.flight.running ? '' : ' (paused)'}`
              : th.flights.length
                ? `not assigned · ${th.flights.length} on server`
                : 'no flights on server'
          },
          {
            k: 'Assignment',
            v: th.assignment?.simulator
              ? `${th.assignment.simulator}${th.assignment.station ? ' / ' + th.assignment.station : ''}`
              : th.waitingForAssignment
                ? 'waiting for the Flight Director'
                : '—'
          },
          {
            k: 'In scope',
            v: th.simulatorsInScope.length
              ? th.simulatorsInScope.map((s) => `${s.name} (L${s.alertLevel ?? '?'})`).join(', ')
              : 'no simulators'
          },
          { k: 'Events/s', v: th.eventsPerSec },
          { k: 'RTT', v: th.rttMs != null ? `${th.rttMs} ms` : '—' }
        ]}
        actions={
          profile.thorium.enabled ? (
            <Button size="sm" onClick={() => void invoke('thorium.reconnect')}>
              Reconnect
            </Button>
          ) : undefined
        }
      />
      <StatusPopover
        tone={profile.mqtt.enabled ? connTone(mq.state) : 'muted'}
        label={`MQTT · ${profile.mqtt.enabled ? connLabel(mq.state) : 'Off'}`}
        icon={<Radio size={13} />}
        title="MQTT"
        fixTo="/setup/mqtt"
        items={[
          { k: 'Broker', v: profile.mqtt.url },
          {
            k: 'State',
            v: mq.reason ? `${connLabel(mq.state)} — ${mq.reason}` : connLabel(mq.state)
          },
          { k: 'Since', v: mq.connectedSince ? formatAgo(mq.connectedSince) : '—' },
          {
            k: 'Subscriptions',
            v: mq.subscriptions.length
              ? mq.subscriptions.map((s) => `${s.topic} (${s.count})`).join(', ')
              : 'none'
          },
          { k: 'Msgs/s', v: mq.messagesPerSec }
        ]}
        actions={
          profile.mqtt.enabled ? (
            <Button size="sm" onClick={() => void invoke('mqtt.reconnect')}>
              Reconnect
            </Button>
          ) : undefined
        }
      />
      <span className="w-px h-6 bg-border mx-1" />
      {outputs.length === 0 && (
        <StatusPopover
          tone="muted"
          label="No outputs"
          icon={<Cable size={13} />}
          title="Outputs"
          fixTo="/setup/outputs"
          items={[{ k: 'Status', v: 'No DMX outputs configured yet' }]}
        />
      )}
      {outputs.map((o) => {
        const h = snap.outputs[o.id]
        const st = o.enabled ? (h?.state ?? 'starting') : 'disabled'
        return (
          <StatusPopover
            key={o.id}
            tone={outputTone(st)}
            label={`${o.name} · ${outputLabel(st)}`}
            icon={<Cable size={13} />}
            title={o.name}
            fixTo="/setup/outputs"
            items={[
              { k: 'Driver', v: o.driver === 'sacn' ? 'sACN (E1.31)' : 'Enttec USB DMX Pro' },
              { k: 'Universe', v: o.universe },
              { k: 'State', v: h?.reason ? `${outputLabel(st)} — ${h.reason}` : outputLabel(st) },
              { k: 'Target', v: h?.detail ?? '—' },
              { k: 'Frame rate', v: h ? `${h.fps} fps` : '—' },
              { k: 'Last send', v: formatAgo(h?.lastSendAt) }
            ]}
            actions={
              <Button size="sm" onClick={() => void invoke('outputs.restart', o.id)}>
                Restart
              </Button>
            }
          />
        )
      })}
      <div className="ml-auto flex items-center gap-2 text-[12px] text-muted shrink-0">
        <Sun size={13} />
        <span className="mono">{Math.round(snap.compositor.grandMaster * 100)}%</span>
        <span className="mx-1 text-faint">·</span>
        <span>{snap.compositor.active.length} active</span>
      </div>
    </div>
  )
}
