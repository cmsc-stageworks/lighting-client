import React, { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { useNavigate } from 'react-router-dom'
import { Activity, Ban, Clapperboard, Eraser } from 'lucide-react'
import type { Scene } from '@shared/types/config'
import { ALERT_LEVELS, ALERT_LEVEL_COLORS } from '@shared/constants'
import { useConfig } from '../../store/config'
import { useRuntime } from '../../store/runtime'
import { useEvents } from '../../store/events'
import { invoke } from '../../lib/api'
import { fmtTime, formatAgo } from '../../lib/format'
import {
  Button,
  Card,
  EmptyState,
  PageHeader,
  SectionTitle,
  Select,
  Tooltip,
  Callout
} from '../../components/ui'

function SceneButton({
  scene,
  active,
  onPress,
  simulatorName
}: {
  scene: Scene
  active: {
    holdUntil: number | null
    releaseStartedAt: number | null
    simulatorName: string | null
  }[]
  onPress: () => void
  simulatorName: string | null
}): React.JSX.Element {
  const isActive = active.length > 0
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!isActive) return
    const t = setInterval(() => setNow(Date.now()), 100)
    return () => clearInterval(t)
  }, [isActive])
  const timed = scene.behavior.kind === 'timed'
  const holdUntil = active[0]?.holdUntil ?? null
  const progress =
    timed && holdUntil
      ? Math.max(
          0,
          Math.min(
            1,
            (holdUntil - now) /
              Math.max(1, scene.behavior.kind === 'timed' ? scene.behavior.holdMs : 1)
          )
        )
      : 0
  return (
    <button
      onClick={onPress}
      className={clsx(
        'relative overflow-hidden text-left rounded-2xl border p-4 min-h-[96px] flex flex-col justify-between transition-all active:scale-[0.98]',
        isActive ? 'border-transparent ring-2' : 'border-border bg-surface hover:bg-surface-2'
      )}
      style={
        isActive
          ? {
              background: `color-mix(in srgb, ${scene.color} 22%, var(--app-surface))`,
              boxShadow: `0 0 0 2px ${scene.color}`
            }
          : undefined
      }
    >
      <div className="flex items-start justify-between gap-2">
        <span className="w-3 h-3 rounded-full mt-1 shrink-0" style={{ background: scene.color }} />
        <span className="text-[11px] text-muted uppercase tracking-wider">
          {timed
            ? `${(scene.behavior.kind === 'timed' ? scene.behavior.holdMs : 0) / 1000}s`
            : 'latch'}
        </span>
      </div>
      <div>
        <div className="font-semibold leading-tight">{scene.name}</div>
        <div className="text-[12px] text-muted mt-0.5 truncate">
          {isActive
            ? `Active${
                active.some((a) => a.simulatorName)
                  ? ' · ' +
                    active
                      .map((a) => a.simulatorName)
                      .filter(Boolean)
                      .join(', ')
                  : ''
              }`
            : scene.addressing === 'relative'
              ? (simulatorName ?? 'all simulators')
              : 'absolute'}
        </div>
      </div>
      {isActive && timed && (
        <div
          className="absolute left-0 bottom-0 h-1 bg-white/70"
          style={{ width: `${progress * 100}%` }}
        />
      )}
    </button>
  )
}

export function DashboardPage(): React.JSX.Element {
  const profile = useConfig((s) => s.draft)
  const snap = useRuntime((s) => s.snapshot)
  const events = useEvents((s) => s.events)
  const nav = useNavigate()
  const [simSel, setSimName] = useState<string>('')

  const simulators = useMemo(() => {
    const inScope = snap?.thorium.simulatorsInScope ?? []
    if (inScope.length) return inScope.map((s) => s.name)
    return (profile?.simulators ?? []).map((s) => s.name)
  }, [snap, profile])

  const simName =
    profile?.kind === 'single-ship' && profile.simulators[0]
      ? profile.simulators[0].name
      : simulators.includes(simSel)
        ? simSel
        : ''

  if (!profile || !snap) return <></>
  const scenes = profile.scenes.filter((s) => s.showOnDashboard)
  const categories = [...new Set(scenes.map((s) => s.category || 'General'))]
  const activeFor = (scene: Scene): typeof snap.compositor.active =>
    snap.compositor.active.filter(
      (a) =>
        a.sceneId === scene.id &&
        (!simName || !a.simulatorName || a.simulatorName.toLowerCase() === simName.toLowerCase())
    )
  const press = (scene: Scene): void => {
    const target = simName || null
    const active = activeFor(scene)
    if (active.length && scene.behavior.kind === 'latch')
      void invoke('scene.release', scene.id, target)
    else void invoke('scene.activate', scene.id, target)
  }
  const recent = events.slice(-8).reverse()

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        title="Dashboard"
        subtitle={
          snap.thorium.flight
            ? `Flight “${snap.thorium.flight.name}” · ${snap.thorium.simulatorsInScope.length} simulator(s) in scope`
            : snap.thorium.waitingForAssignment
              ? 'Waiting for the Flight Director to assign this client'
              : profile.thorium.enabled
                ? snap.thorium.flights.length
                  ? `${snap.thorium.flights.length} flight(s) running · ${snap.thorium.simulatorsInScope.length} simulator(s) in scope`
                  : 'Waiting for a running flight'
                : 'Thorium source is off'
        }
        actions={
          simulators.length > 1 ? (
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-muted">Simulator</span>
              <Select
                value={simName}
                onChange={setSimName}
                options={[
                  { value: '', label: 'All in scope' },
                  ...simulators.map((s) => ({ value: s, label: s }))
                ]}
                className="w-48"
              />
            </div>
          ) : undefined
        }
      />

      {snap.thorium.waitingForAssignment && (
        <Callout tone="warning" className="mb-5">
          <b>Not assigned to a flight.</b> This client only acts on the flight the Flight Director
          assigns it to. Open Thorium’s Clients list and assign “{profile.thorium.clientLabel}” to
          this room’s flight. Until then no mappings run; Dashboard buttons still work.
        </Callout>
      )}
      {/* Alert levels */}
      {snap.thorium.simulatorsInScope.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-5">
          {snap.thorium.simulatorsInScope.map((s) => (
            <div key={s.id} className="card px-3 py-2 flex items-center gap-3">
              <span className="font-medium">{s.name}</span>
              <span
                className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-2 h-6 rounded-full"
                style={{
                  background: `color-mix(in srgb, ${ALERT_LEVEL_COLORS[(s.alertLevel as keyof typeof ALERT_LEVEL_COLORS) ?? '5'] ?? '#888'} 20%, transparent)`,
                  color:
                    ALERT_LEVEL_COLORS[(s.alertLevel as keyof typeof ALERT_LEVEL_COLORS) ?? '5'] ??
                    '#888'
                }}
              >
                Alert {s.alertLevel?.toUpperCase() ?? '?'}
                {s.training && ' · training'}
              </span>
              <Tooltip content="Manual alert override (fires the same mappings as a Thorium alert change)">
                <select
                  className="input !h-7 !py-0 !w-24 text-[12px]"
                  value={snap.alertOverrides[s.name] ?? ''}
                  onChange={(e) =>
                    void invoke('thorium.setAlertOverride', s.name, e.target.value || null)
                  }
                >
                  <option value="">override…</option>
                  {ALERT_LEVELS.map((l) => (
                    <option key={l} value={l}>
                      Level {l.toUpperCase()}
                    </option>
                  ))}
                </select>
              </Tooltip>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-[1fr_300px] gap-5 items-start">
        <div>
          {scenes.length === 0 ? (
            <EmptyState
              icon={<Clapperboard size={28} />}
              title="No scenes on the dashboard yet"
              body="Scenes marked “show on dashboard” appear here as big buttons. Create one to get started."
              action={
                <Button variant="primary" onClick={() => nav('/scenes')}>
                  Go to Scenes
                </Button>
              }
            />
          ) : (
            categories.map((cat) => (
              <div key={cat} className="mb-6">
                <SectionTitle>{cat}</SectionTitle>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
                  {scenes
                    .filter((s) => (s.category || 'General') === cat)
                    .map((scene) => (
                      <SceneButton
                        key={scene.id}
                        scene={scene}
                        active={activeFor(scene)}
                        onPress={() => press(scene)}
                        simulatorName={simName || null}
                      />
                    ))}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <SectionTitle>Global</SectionTitle>
            <div className="flex flex-col gap-2">
              <Button
                variant={snap.compositor.blackout ? 'secondary' : 'danger'}
                size="lg"
                icon={<Ban size={18} />}
                className="w-full"
                onClick={() => void invoke('compositor.setBlackout', !snap.compositor.blackout)}
              >
                {snap.compositor.blackout ? 'Release blackout' : 'Blackout'}
              </Button>
              <Button
                size="lg"
                icon={<Eraser size={18} />}
                className="w-full"
                onClick={() => void invoke('compositor.releaseAll')}
              >
                Release all scenes
              </Button>
            </div>
          </Card>

          <Card>
            <SectionTitle>Active scenes</SectionTitle>
            {snap.compositor.active.length === 0 ? (
              <div className="text-muted text-[13px]">
                Nothing active. Output is at the base level (0).
              </div>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {snap.compositor.active.map((a) => (
                  <li
                    key={a.instanceId}
                    className="flex items-center justify-between text-[13px] gap-2"
                  >
                    <span className="truncate">
                      <span className="font-medium">{a.sceneName}</span>
                      {a.simulatorName && <span className="text-muted"> · {a.simulatorName}</span>}
                    </span>
                    <span className="text-faint shrink-0">
                      {profile.layers.find((l) => l.id === a.layerId)?.name}
                      {a.releaseStartedAt ? ' · fading' : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <SectionTitle
              action={
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Activity size={14} />}
                  onClick={() => nav('/setup/thorium')}
                >
                  Inspector
                </Button>
              }
            >
              Recent activity
            </SectionTitle>
            {recent.length === 0 ? (
              <div className="text-muted text-[13px]">No events yet.</div>
            ) : (
              <ul className="flex flex-col gap-1">
                {recent.map((e) => (
                  <li key={e.id} className="text-[12px] flex gap-2 items-baseline">
                    <span className="mono text-faint shrink-0">{fmtTime(e.ts)}</span>
                    <span className="truncate">
                      <span
                        className={clsx(e.matchedMappingIds.length ? 'text-accent' : 'text-muted')}
                      >
                        {e.name}
                      </span>
                      {e.simulatorName && <span className="text-faint"> · {e.simulatorName}</span>}
                    </span>
                    {e.matchedMappingIds.length > 0 && (
                      <span className="ml-auto text-faint shrink-0">
                        {e.matchedMappingIds.length} rule{e.matchedMappingIds.length > 1 ? 's' : ''}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <div className="text-faint text-[11px] mt-2">
              Thorium{' '}
              {snap.thorium.state === 'connected'
                ? `connected ${formatAgo(snap.thorium.since)}`
                : snap.thorium.state}
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
