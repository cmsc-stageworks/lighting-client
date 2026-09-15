import React, { useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { useNavigate } from 'react-router-dom'
import * as Popover from '@radix-ui/react-popover'
import { ShieldCheck } from 'lucide-react'
import {
  LIGHTING_MODES,
  LIGHTING_MODE_INFO,
  LIGHTING_MODE_RANK,
  type LightingMode
} from '@shared/lightingMode'
import { useRuntime } from '../../store/runtime'
import { useConfig } from '../../store/config'
import { useEvents } from '../../store/events'
import { invoke } from '../../lib/api'
import { fmtTime } from '../../lib/format'
import { MODE_ICON, heldBackReasons, reducedHeldBack, useModeDialog } from '../../lib/lightingMode'
import { Button, Callout, Checkbox, Modal, Tooltip } from '../ui'

const SEGMENT_ACTIVE: Record<LightingMode, string> = {
  normal: 'bg-success/20 text-success border-success/40',
  reduced: 'bg-warning/20 text-warning border-warning/50',
  locked: 'bg-info/20 text-info border-info/50'
}
const BANNER: Record<Exclude<LightingMode, 'normal'>, string> = {
  reduced: 'bg-warning/15 border-warning/40 text-warning',
  locked: 'bg-info/15 border-info/40 text-info'
}

function sinceLabel(ts: number): string {
  const d = new Date(ts)
  const today = new Date()
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  if (d.toDateString() === today.toDateString()) return time
  if (d.toDateString() === yesterday.toDateString()) return `yesterday at ${time}`
  return `${d.toLocaleDateString()} at ${time}`
}

// ---------------------------------------------------------------- status bar control

/** Always-visible three-way switch. Clicking another mode opens the confirm dialog. */
export function LightingModeControl(): React.JSX.Element | null {
  const mode = useRuntime((s) => s.snapshot?.lightingMode.mode)
  const openDialog = useModeDialog((s) => s.open)
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  if (!mode) return null
  const onKey = (e: React.KeyboardEvent, i: number): void => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    const n = LIGHTING_MODES.length
    refs.current[(i + (e.key === 'ArrowRight' ? 1 : n - 1)) % n]?.focus()
  }
  return (
    <div
      role="radiogroup"
      aria-label="Lighting mode"
      className="shrink-0 inline-flex items-center gap-0.5 p-0.5 rounded-full border border-border bg-surface-2"
    >
      {LIGHTING_MODES.map((m, i) => {
        const Icon = MODE_ICON[m]
        const active = m === mode
        return (
          <Tooltip key={m} content={LIGHTING_MODE_INFO[m].description} side="bottom">
            <button
              ref={(el) => {
                refs.current[i] = el
              }}
              role="radio"
              aria-checked={active}
              onKeyDown={(e) => onKey(e, i)}
              onClick={() => !active && openDialog(m)}
              className={clsx(
                'h-7 px-2.5 rounded-full border text-[12px] font-semibold inline-flex items-center gap-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                active
                  ? SEGMENT_ACTIVE[m]
                  : 'border-transparent text-muted hover:text-text hover:bg-surface-3'
              )}
            >
              <Icon size={13} />
              {LIGHTING_MODE_INFO[m].short}
            </button>
          </Tooltip>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------- confirm dialog

export function LightingModeDialog(): React.JSX.Element {
  const target = useModeDialog((s) => s.target)
  // Keyed by target so each opening starts with fresh checkbox defaults.
  return target ? <ModeDialogBody key={target} target={target} /> : <></>
}

function ModeDialogBody({ target }: { target: LightingMode }): React.JSX.Element {
  const close = useModeDialog((s) => s.close)
  const snap = useRuntime((s) => s.snapshot)
  const profile = useConfig((s) => s.draft)
  const dirty = useConfig((s) => s.dirty)
  const nav = useNavigate()
  const [releaseUncleared, setReleaseUncleared] = useState(true)
  const [catchUp, setCatchUp] = useState(true)
  const [busy, setBusy] = useState(false)

  const current = snap?.lightingMode.mode ?? 'normal'
  const scenes = useMemo(() => profile?.scenes ?? [], [profile])
  const cleared = useMemo(() => scenes.filter((s) => s.reducedEffectsCleared), [scenes])
  const activeUncleared = useMemo(() => {
    const ok = new Set(cleared.map((s) => s.id))
    const names = (snap?.compositor.active ?? [])
      .filter((a) => !a.releaseStartedAt && !ok.has(a.sceneId))
      .map((a) => a.sceneName)
    return [...new Set(names)]
  }, [snap, cleared])
  const rulesHeldBack = useMemo(
    () =>
      (profile?.mappings ?? []).filter((m) => m.enabled && reducedHeldBack(m, scenes).length > 0)
        .length,
    [profile, scenes]
  )
  const alertLevels = useMemo(
    () =>
      (snap?.thorium.simulatorsInScope ?? [])
        .filter((s) => s.alertLevel != null)
        .map(
          (s) =>
            `Alert ${(snap?.alertOverrides[s.name] ?? s.alertLevel)?.toUpperCase()} on ${s.name}`
        ),
    [snap]
  )

  const safer = LIGHTING_MODE_RANK[target] > LIGHTING_MODE_RANK[current]
  const confirm = async (): Promise<void> => {
    setBusy(true)
    try {
      await invoke('lightingMode.set', target, {
        releaseUncleared: target === 'reduced' && releaseUncleared && activeUncleared.length > 0,
        catchUpAlerts: !safer && catchUp && alertLevels.length > 0
      })
      close()
    } finally {
      setBusy(false)
    }
  }

  const Icon = MODE_ICON[target]
  const title =
    target === 'reduced' && safer
      ? 'Switch to Reduced Effects?'
      : target === 'locked'
        ? 'Lock the lights?'
        : target === 'normal'
          ? 'Return to Normal?'
          : 'Unlock to Reduced Effects?'

  return (
    <Modal
      open
      onClose={close}
      width="max-w-lg"
      title={
        <span className="inline-flex items-center gap-2">
          <Icon size={18} />
          {title}
        </span>
      }
      footer={
        <>
          {/* Moving to a less protective mode starts on Cancel so a stray Enter can't remove protection. */}
          <Button variant="ghost" onClick={close} autoFocus={!safer}>
            Cancel
          </Button>
          <Button
            variant={
              target === 'reduced' ? 'warning' : target === 'normal' ? 'success' : 'secondary'
            }
            className={clsx(
              target === 'locked' && 'bg-info/15 text-info border-info/40 hover:bg-info/25'
            )}
            loading={busy}
            onClick={() => void confirm()}
            autoFocus={safer}
          >
            {target === 'locked'
              ? 'Lock lights'
              : target === 'normal'
                ? 'Return to Normal'
                : 'Switch to Reduced Effects'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-[13px]">
        {target === 'reduced' && (
          <>
            <p>
              Thorium and MQTT can only turn on scenes <b>cleared for Reduced Effects</b>. Turning
              scenes off still works. Blackout and other effects from triggers are held back.
              Dashboard buttons still work.
            </p>
            {cleared.length === 0 ? (
              <Callout tone="warning">
                <b>No scenes are cleared yet</b>, so every lighting trigger will be held back.
                <div className="mt-2">
                  <Button
                    size="sm"
                    onClick={() => {
                      close()
                      nav('/scenes')
                    }}
                  >
                    Open Scenes
                  </Button>
                </div>
              </Callout>
            ) : (
              <div>
                <div className="text-muted mb-1.5">
                  Cleared scenes ({cleared.length}) — the only ones triggers can turn on:
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {cleared.map((s) => (
                    <span
                      key={s.id}
                      className="inline-flex items-center gap-1 h-6 px-2 rounded-full border border-border bg-surface-2 text-[12px]"
                    >
                      <ShieldCheck size={12} className="text-success" />
                      {s.name}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {activeUncleared.length > 0 && (
              <div className="rounded-xl border border-border p-3">
                <Checkbox
                  checked={releaseUncleared}
                  onChange={setReleaseUncleared}
                  label={
                    <span>
                      Turn off {activeUncleared.length === 1 ? 'this' : 'these'}{' '}
                      {activeUncleared.length} active scene{activeUncleared.length === 1 ? '' : 's'}{' '}
                      that {activeUncleared.length === 1 ? "isn't" : "aren't"} cleared
                    </span>
                  }
                />
                <div className="text-muted mt-1.5 ml-7">{activeUncleared.join(', ')}</div>
              </div>
            )}
            {rulesHeldBack > 0 && (
              <div className="text-muted">
                {rulesHeldBack} rule{rulesHeldBack === 1 ? '' : 's'} turn on scenes that aren’t
                cleared (or use blackout); {rulesHeldBack === 1 ? 'it' : 'they'}’ll be held back.{' '}
                <button
                  className="text-accent hover:underline"
                  onClick={() => {
                    close()
                    nav('/mappings?status=reducedHeldBack')
                  }}
                >
                  Review rules
                </button>
              </div>
            )}
          </>
        )}
        {target === 'locked' && (
          <>
            <p>
              The lights stay <b>exactly as they are now</b>. Thorium and MQTT can’t change them.
            </p>
            <p>
              To change the look, press a Dashboard button or use the Alert override.{' '}
              <span className="text-muted">
                Tip: set the Alert override to Level 5 for a steady look all mission.
              </span>
            </p>
          </>
        )}
        {!safer && (
          <>
            {target === 'normal' && (
              <p>
                Full lighting effects will resume. Check that guests with light sensitivity are
                finished or have agreed.
              </p>
            )}
            {alertLevels.length > 0 && (
              <div className="rounded-xl border border-border p-3">
                <Checkbox
                  checked={catchUp}
                  onChange={setCatchUp}
                  label={<span>Catch the lights up to the current alert level</span>}
                />
                <div className="text-muted mt-1.5 ml-7">{alertLevels.join(', ')}</div>
              </div>
            )}
          </>
        )}
        {dirty && (
          <Callout tone="muted">
            You have unsaved changes. Scene clearance is applied from the <b>saved</b>{' '}
            configuration.
          </Callout>
        )}
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------- banner

export function LightingModeBanner(): React.JSX.Element | null {
  const lm = useRuntime((s) => s.snapshot?.lightingMode)
  const events = useEvents((s) => s.events)
  const openDialog = useModeDialog((s) => s.open)
  const nav = useNavigate()
  const since = lm?.since ?? 0
  const recent = useMemo(
    () =>
      events
        .filter((e) => e.ts >= since)
        .flatMap((e) => heldBackReasons(e).map((text) => ({ id: e.id, ts: e.ts, text })))
        .slice(-15)
        .reverse(),
    [events, since]
  )
  if (!lm || lm.mode === 'normal') return null
  const mode = lm.mode
  const Icon = MODE_ICON[mode]
  const label = mode === 'reduced' ? 'REDUCED EFFECTS' : 'LIGHTS LOCKED'
  const explain =
    mode === 'reduced'
      ? 'Only cleared scenes respond to Thorium/MQTT'
      : 'Only this app changes the lights'
  const count = lm.heldBack.count

  return (
    <div
      role="status"
      aria-live="polite"
      className={clsx(
        'border-b text-[13px] px-4 min-h-10 py-1.5 flex items-center gap-x-3 gap-y-1 flex-wrap',
        BANNER[mode]
      )}
    >
      {lm.staleDay ? (
        <span className="font-semibold inline-flex items-center gap-2">
          <Icon size={15} />
          {LIGHTING_MODE_INFO[mode].label} was turned on {sinceLabel(lm.since)}. Is it still needed
          today?
        </span>
      ) : (
        <span className="inline-flex items-center gap-2 flex-wrap">
          <Icon size={15} />
          <span className="font-bold tracking-wide">{label}</span>
          <span className="text-text/80">· {explain}</span>
          <span className="text-text/60">· since {sinceLabel(lm.since)}</span>
          {count > 0 && (
            <span className="text-text/80">
              · {count} trigger{count === 1 ? '' : 's'} held back
            </span>
          )}
        </span>
      )}
      <span className="ml-auto flex items-center gap-2">
        {lm.staleDay ? (
          <Button size="sm" onClick={() => void invoke('lightingMode.keepForToday')}>
            Keep for today
          </Button>
        ) : (
          <Popover.Root>
            <Popover.Trigger asChild>
              <Button size="sm" variant="ghost" className="!text-inherit">
                What was held back?
              </Button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                sideOffset={6}
                align="end"
                className="z-50 w-[420px] max-w-[90vw] card p-4 shadow-2xl"
              >
                <div className="font-semibold mb-1">Held back since {sinceLabel(lm.since)}</div>
                <div className="text-muted text-[12px] mb-2">
                  These triggers matched, but the lighting mode stopped them changing the lights.
                </div>
                {recent.length === 0 ? (
                  <div className="text-muted text-[13px]">Nothing has been held back yet.</div>
                ) : (
                  <ul className="flex flex-col gap-1.5 max-h-72 overflow-y-auto">
                    {recent.map((r, i) => (
                      <li key={`${r.id}-${i}`} className="text-[12px] flex gap-2">
                        <span className="mono text-faint shrink-0">{fmtTime(r.ts)}</span>
                        <span>{r.text}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="flex justify-end mt-3">
                  <Button size="sm" onClick={() => nav('/setup/thorium?heldBack=1')}>
                    Open Event Inspector
                  </Button>
                </div>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        )}
        <Button size="sm" variant="secondary" onClick={() => openDialog('normal')}>
          {mode === 'locked' && !lm.staleDay ? 'Unlock…' : 'Return to Normal'}
        </Button>
      </span>
    </div>
  )
}
