import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, FlaskConical, RefreshCw, X } from 'lucide-react'
import type { ThoriumScope } from '@shared/types/config'
import type { ThoriumTestReport } from '@shared/types/state'
import { THORIUM_DEFAULT_PORT, THORIUM_DEV_PORT } from '@shared/constants'
import { useConfig } from '../../store/config'
import { useRuntime } from '../../store/runtime'
import { invoke } from '../../lib/api'
import { connLabel, connTone } from '../../lib/format'
import {
  Badge,
  Button,
  Callout,
  Card,
  Checkbox,
  Field,
  Input,
  KeyValue,
  NumberInput,
  PageHeader,
  Pill,
  SectionTitle,
  Select,
  Switch
} from '../../components/ui'
import { EventInspector } from './EventInspector'

export function ThoriumPage(): React.JSX.Element {
  const profile = useConfig((s) => s.draft)
  const update = useConfig((s) => s.update)
  const dirty = useConfig((s) => s.dirty)
  const snapshot = useRuntime((s) => s.snapshot)
  const refData = useRuntime((s) => s.refData)
  const refresh = useRuntime((s) => s.refreshRefData)
  const nav = useNavigate()
  const [test, setTest] = useState<ThoriumTestReport | 'running' | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  if (!profile || !snapshot) return <></>
  const th = profile.thorium
  const rt = snapshot.thorium
  const set = (p: Partial<typeof th>): void =>
    update((d) => ({ ...d, thorium: { ...d.thorium, ...p } }))
  const setScope = (scope: ThoriumScope): void => set({ scope })
  const runTest = async (): Promise<void> => {
    setTest('running')
    setTest(await invoke('thorium.test'))
  }
  const knownNames = [
    ...new Set([...refData.simulators.map((s) => s.name), ...profile.simulators.map((s) => s.name)])
  ]

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        title="Thorium"
        subtitle="Connects as a Thorium client, listens to every event, and derives lighting-relevant state changes."
        actions={
          <>
            <Pill tone={th.enabled ? connTone(rt.state) : 'muted'}>
              {th.enabled ? connLabel(rt.state) : 'Disabled'}
            </Pill>
            <Button
              icon={<FlaskConical size={16} />}
              loading={test === 'running'}
              onClick={() => void runTest()}
              disabled={dirty}
            >
              Test connection
            </Button>
          </>
        }
      />
      {dirty && (
        <Callout tone="warning" className="mb-4">
          Connection changes apply after you save.
        </Callout>
      )}

      <div className="grid grid-cols-[1fr_1fr] gap-4 mb-4">
        <Card>
          <SectionTitle
            action={
              <Switch
                checked={th.enabled}
                onChange={(v) => set({ enabled: v })}
                label={th.enabled ? 'On' : 'Off'}
              />
            }
          >
            Server
          </SectionTitle>
          <div className="grid grid-cols-[1fr_120px] gap-3">
            <Field label="Host">
              <Input
                value={th.host}
                onChange={(e) => set({ host: e.target.value })}
                placeholder="localhost or 10.0.0.5"
              />
            </Field>
            <Field label="Port">
              <NumberInput value={th.port} min={1} max={65535} onChange={(v) => set({ port: v })} />
            </Field>
          </div>
          <div className="flex items-center gap-3 mt-2 text-[12px]">
            <button className="text-accent" onClick={() => set({ port: THORIUM_DEFAULT_PORT })}>
              Production ({THORIUM_DEFAULT_PORT})
            </button>
            <button className="text-accent" onClick={() => set({ port: THORIUM_DEV_PORT })}>
              Dev ({THORIUM_DEV_PORT})
            </button>
            <span className="ml-auto">
              <Checkbox
                checked={th.secure}
                onChange={(v) => set({ secure: v })}
                label="HTTPS / WSS"
              />
            </span>
          </div>
          <Field
            label="Client label"
            hint="Shown in the Flight Director's client list"
            className="mt-3"
          >
            <Input value={th.clientLabel} onChange={(e) => set({ clientLabel: e.target.value })} />
          </Field>
          <Field label="Client id" hint="Stable id used to register with Thorium" className="mt-3">
            <Input
              value={th.clientId}
              onChange={(e) => set({ clientId: e.target.value })}
              className="mono"
            />
          </Field>
        </Card>

        <Card>
          <SectionTitle>Simulator scope</SectionTitle>
          <Select
            value={th.scope.mode}
            onChange={(v) =>
              setScope(
                v === 'pinned'
                  ? {
                      mode: 'pinned',
                      simulatorNames: th.scope.mode === 'pinned' ? th.scope.simulatorNames : []
                    }
                  : v === 'follow-assignment'
                    ? { mode: 'follow-assignment' }
                    : v === 'assigned-flight'
                      ? { mode: 'assigned-flight' }
                      : { mode: 'all' }
              )
            }
            options={[
              {
                value: 'follow-assignment',
                label: 'What the FD assigns this client to (simulator, or whole flight) — per room'
              },
              {
                value: 'assigned-flight',
                label: 'Every simulator of the FD-assigned flight'
              },
              { value: 'pinned', label: 'Specific simulators by name (newest flight wins)' },
              { value: 'all', label: 'Every simulator in every flight (central)' }
            ]}
          />
          {(th.scope.mode === 'assigned-flight' || th.scope.mode === 'follow-assignment') && (
            <Field label="When the FD un-assigns or moves this client" className="mt-3">
              <Select
                value={th.unassignedBehavior}
                onChange={(v) => set({ unassignedBehavior: v as 'release' | 'hold' })}
                options={[
                  { value: 'release', label: 'Release all scenes (lights fall back to base)' },
                  { value: 'hold', label: 'Hold the current output until re-assigned' }
                ]}
              />
            </Field>
          )}
          {th.scope.mode === 'pinned' && (
            <div className="mt-3">
              <div className="field-label">Simulator names</div>
              <div className="flex flex-wrap gap-2">
                {knownNames.map((n) => {
                  const on =
                    th.scope.mode === 'pinned' &&
                    th.scope.simulatorNames.some((x) => x.toLowerCase() === n.toLowerCase())
                  return (
                    <button
                      key={n}
                      onClick={() =>
                        th.scope.mode === 'pinned' &&
                        setScope({
                          mode: 'pinned',
                          simulatorNames: on
                            ? th.scope.simulatorNames.filter(
                                (x) => x.toLowerCase() !== n.toLowerCase()
                              )
                            : [...th.scope.simulatorNames, n]
                        })
                      }
                      className={
                        on
                          ? 'h-8 px-3 rounded-full bg-accent/20 text-accent border border-accent/40 text-[13px] font-medium'
                          : 'h-8 px-3 rounded-full bg-surface-2 text-muted border border-border text-[13px]'
                      }
                    >
                      {n}
                    </button>
                  )
                })}
                <Input
                  placeholder="Other name + Enter"
                  className="!h-8 !w-44"
                  onKeyDown={(e) => {
                    const v = (e.target as HTMLInputElement).value.trim()
                    if (e.key === 'Enter' && v && th.scope.mode === 'pinned') {
                      setScope({ mode: 'pinned', simulatorNames: [...th.scope.simulatorNames, v] })
                      ;(e.target as HTMLInputElement).value = ''
                    }
                  }}
                />
              </div>
            </div>
          )}
          {(th.scope.mode === 'assigned-flight' || th.scope.mode === 'follow-assignment') && (
            <Callout tone={rt.waitingForAssignment ? 'warning' : 'info'} className="mt-3">
              {rt.assignment?.flight
                ? `Assigned to flight “${rt.assignment.flight}”${rt.assignment.simulator ? ` · ${rt.assignment.simulator}` : ''}${rt.assignment.station ? ` / ${rt.assignment.station}` : ''}.`
                : `Not assigned. In Thorium’s Clients list, assign “${th.clientLabel}” to this room’s flight${th.scope.mode === 'follow-assignment' ? ' and simulator' : ''}. Nothing fires until then.`}
            </Callout>
          )}
          {rt.scopeWarnings
            .filter((w) => !/Not assigned/.test(w))
            .map((w, i) => (
              <Callout key={i} tone="warning" className="mt-3">
                {w}
              </Callout>
            ))}
          {rt.flights.length > 0 && (
            <div className="mt-4">
              <div className="field-label">Flights on this server</div>
              <div className="flex flex-col gap-1 text-[13px]">
                {rt.flights.map((f) => (
                  <div key={f.id} className="flex items-center gap-2">
                    <Badge tone={rt.assignment?.flightId === f.id ? 'success' : 'muted'}>
                      {rt.assignment?.flightId === f.id
                        ? 'assigned'
                        : f.running
                          ? 'running'
                          : 'paused'}
                    </Badge>
                    <span className="font-medium">{f.name || f.id}</span>
                    <span className="text-muted">{f.simulators.join(', ') || 'no simulators'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="mt-4">
            <div className="field-label">In scope now</div>
            {rt.simulatorsInScope.length === 0 ? (
              <div className="text-muted text-[13px]">
                {rt.state === 'connected'
                  ? 'No simulators match the scope (is a flight running?)'
                  : 'Not connected'}
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {rt.simulatorsInScope.map((s) => (
                  <Badge key={s.id} tone={s.profileId ? 'success' : 'warning'}>
                    {s.name} · L{s.alertLevel ?? '?'}
                    {!s.profileId && ' · no profile'}
                  </Badge>
                ))}
              </div>
            )}
            {rt.simulatorsInScope.some((s) => !s.profileId) && (
              <button
                className="text-accent text-[12px] mt-2"
                onClick={() => nav('/setup/simulators')}
              >
                Add missing simulator profiles →
              </button>
            )}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-[1fr_1fr] gap-4 mb-4">
        <Card>
          <SectionTitle>Derived event thresholds</SectionTitle>
          <Field
            label="Battery thresholds (0–1, comma separated)"
            hint="Battery-below / above triggers fire when the battery level crosses these values."
          >
            <Input
              value={th.batteryThresholds.join(', ')}
              onChange={(e) =>
                set({
                  batteryThresholds: e.target.value
                    .split(',')
                    .map((x) => Number(x.trim()))
                    .filter((n) => !Number.isNaN(n) && n >= 0 && n <= 1)
                })
              }
              className="mono"
            />
          </Field>
          <Field label="Reactor heat threshold (0–1)" className="mt-3">
            <NumberInput
              value={th.reactorHeatThreshold}
              min={0}
              max={1}
              step={0.05}
              onChange={(v) => set({ reactorHeatThreshold: v })}
            />
          </Field>
        </Card>
        <Card>
          <SectionTitle
            action={
              <Button
                size="sm"
                variant="ghost"
                icon={<RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />}
                onClick={() => {
                  setRefreshing(true)
                  void refresh().finally(() => setRefreshing(false))
                }}
              >
                Refresh
              </Button>
            }
          >
            Status
          </SectionTitle>
          <KeyValue
            items={[
              {
                k: 'Server',
                v: rt.serverId ? `${th.host}:${th.port} · ${rt.serverId}` : `${th.host}:${th.port}`
              },
              { k: 'Round trip', v: rt.rttMs != null ? `${rt.rttMs} ms` : '—' },
              {
                k: 'Assigned flight',
                v: rt.flight
                  ? `${rt.flight.name}${rt.flight.running ? '' : ' (paused)'}`
                  : rt.flights.length
                    ? `not assigned · ${rt.flights.length} flight(s) on server`
                    : 'no flights on server'
              },
              {
                k: 'Assignment',
                v: rt.assignment?.simulator
                  ? `${rt.assignment.simulator}${rt.assignment.station ? ' / ' + rt.assignment.station : ''}`
                  : 'not assigned'
              },
              { k: 'Events / s', v: rt.eventsPerSec },
              { k: 'Reconnects', v: rt.reconnects },
              {
                k: 'Reference data',
                v: refData.fetchedAt
                  ? `${refData.macros.length} macro${refData.macros.length === 1 ? '' : 's'}, ${refData.macroButtonConfigs.reduce((n, c) => n + c.buttons.length, 0)} buttons, ${refData.missions.length} missions`
                  : 'not loaded'
              }
            ]}
          />
          {test && test !== 'running' && (
            <div className="mt-3 rounded-lg bg-surface-2 p-3">
              <div className="flex items-center gap-2 mb-1.5">
                <Badge tone={test.ok ? 'success' : 'danger'}>{test.ok ? 'PASS' : 'FAIL'}</Badge>
                <span className="text-[12px] text-faint">{test.durationMs} ms</span>
              </div>
              {test.steps.map((s, i) => (
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
          )}
        </Card>
      </div>

      <Card className="mb-4">
        <SectionTitle>Event inspector</SectionTitle>
        <EventInspector onCreateTrigger={(e) => nav('/mappings', { state: { fromEvent: e } })} />
      </Card>
    </div>
  )
}
