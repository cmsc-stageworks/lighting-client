import React, { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowLeft,
  Copy,
  GitBranch,
  Globe,
  Layers,
  Plus,
  Ship,
  Trash2
} from 'lucide-react'
import type { Action, Mapping } from '@shared/types/config'
import type { AppEvent } from '@shared/types/events'
import { getPreset, PRESET_GROUPS, summarizeTrigger } from '@shared/triggers/catalog'
import { eqIgnoreCase, uuid } from '@shared/utils'
import { useConfig } from '../../store/config'
import { useRuntime } from '../../store/runtime'
import { toast } from '../../store/toasts'
import { formatAgo } from '../../lib/format'
import {
  Badge,
  Button,
  Checkbox,
  EmptyState,
  InlineConfirm,
  Modal,
  PageHeader,
  SearchInput,
  Select,
  Switch,
  Tabs
} from '../../components/ui'
import { MappingEditor, SimulatorChips } from './MappingEditor'
import { SimulatePanel } from './SimulatePanel'

const ANY = '__any__'

function describeAction(
  a: Action,
  sceneName: (id: string) => string,
  layerName: (id: string) => string
): string {
  switch (a.kind) {
    case 'activateScene':
      return `Activate “${sceneName(a.sceneId)}”`
    case 'releaseScene':
      return `Release “${sceneName(a.sceneId)}”`
    case 'releaseLayer':
      return `Release layer ${layerName(a.layerId)}`
    case 'releaseAll':
      return 'Release all'
    case 'blackout':
      return a.on ? 'Blackout on' : 'Blackout off'
    case 'publishMqtt':
      return `Publish ${a.topic}`
    case 'thoriumMutation':
      return a.mutation.kind === 'triggerMacro'
        ? `Macro “${a.mutation.macroName}”`
        : a.mutation.kind === 'setAlertLevel'
          ? `Alert level ${a.mutation.level}`
          : 'Notify FD'
  }
}

/** Build a sensible new mapping from an inspector event. */
function mappingFromEvent(e: AppEvent, firstSceneId: string | undefined): Mapping {
  let trigger: Mapping['trigger']
  const sims = e.simulatorName ? [e.simulatorName] : []
  if (e.type === 'mqtt.message')
    trigger = {
      preset: 'mqtt.message',
      params: { topic: e.name },
      conditions: [],
      simulatorNames: []
    }
  else if (e.type === 'thorium.state' && e.name === 'alertLevel.changed')
    trigger = {
      preset: 'thorium.alertLevel',
      params: { levels: [String(e.data.level ?? '5')], includeInitial: true },
      conditions: [],
      simulatorNames: sims
    }
  else if (e.type === 'thorium.event' && e.name === 'generic')
    trigger = {
      preset: 'thorium.generic',
      params: { key: String(e.data.key ?? '') },
      conditions: [],
      simulatorNames: sims
    }
  else if (e.type === 'thorium.event' && e.name === 'triggerAction')
    trigger = {
      preset: 'thorium.action',
      params: { actions: [String(e.data.action ?? 'flash')] },
      conditions: [],
      simulatorNames: sims
    }
  else if (e.type === 'thorium.event' && e.name === 'triggerMacroAction')
    trigger = {
      preset: 'custom.event',
      params: { eventName: e.name },
      conditions: [{ path: 'macroId', op: 'eq', value: String(e.data.macroId ?? '') }],
      simulatorNames: sims
    }
  else if (e.type === 'thorium.event')
    trigger = {
      preset: 'custom.event',
      params: { eventName: e.name },
      conditions: [],
      simulatorNames: sims
    }
  else
    trigger = {
      preset: 'custom.any',
      params: {},
      conditions: [{ path: 'event', op: 'eq', value: e.name }],
      simulatorNames: sims
    }
  return {
    id: uuid(),
    name: `On ${e.name}${e.simulatorName ? ` (${e.simulatorName})` : ''}`,
    enabled: true,
    category: e.simulatorName ?? 'General',
    trigger,
    actions: firstSceneId
      ? [
          {
            kind: 'activateScene',
            sceneId: firstSceneId,
            target: 'event',
            layerId: null,
            holdMsOverride: null
          }
        ]
      : [],
    debounceMs: 0,
    notes: `Created from an event seen at ${new Date(e.ts).toLocaleTimeString()}.`
  }
}

export function MappingsPage(): React.JSX.Element {
  const profile = useConfig((s) => s.draft)
  const update = useConfig((s) => s.update)
  const snapshot = useRuntime((s) => s.snapshot)
  const loc = useLocation()
  const nav = useNavigate()
  const [editing, setEditing] = useState<string | null>(null)
  const [tab, setTab] = useState('list')
  // Filters
  const [q, setQ] = useState('')
  const [simFilter, setSimFilter] = useState('')
  const [catFilter, setCatFilter] = useState('')
  const [groupFilter, setGroupFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [groupBySim, setGroupBySim] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [copyTarget, setCopyTarget] = useState<string[] | null>(null)

  useEffect(() => {
    // Responds to router state handed over from the inspector; a genuine external event.
    const st = loc.state as { fromEvent?: AppEvent } | null
    if (st?.fromEvent && profile) {
      const m = mappingFromEvent(st.fromEvent, profile.scenes[0]?.id)
      update((d) => ({ ...d, mappings: [...d.mappings, m] }))
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEditing(m.id)
      nav('/mappings', { replace: true, state: null })
    }
  }, [loc.state, profile, update, nav])

  const simulatorNames = useMemo(() => {
    const out: string[] = []
    const add = (n: string): void => {
      if (n && !out.some((x) => eqIgnoreCase(x, n))) out.push(n)
    }
    for (const s of profile?.simulators ?? []) add(s.name)
    for (const s of snapshot?.thorium.simulatorsInScope ?? []) add(s.name)
    for (const m of profile?.mappings ?? []) for (const n of m.trigger.simulatorNames) add(n)
    return out
  }, [profile, snapshot])
  const categories = useMemo(
    () => [...new Set((profile?.mappings ?? []).map((m) => m.category || 'General'))].sort(),
    [profile]
  )

  const filtered = useMemo(() => {
    const list = profile?.mappings ?? []
    return list.filter((m) => {
      if (simFilter === ANY && m.trigger.simulatorNames.length > 0) return false
      if (
        simFilter &&
        simFilter !== ANY &&
        !m.trigger.simulatorNames.some((n) => eqIgnoreCase(n, simFilter))
      )
        return false
      if (catFilter && (m.category || 'General') !== catFilter) return false
      if (groupFilter && getPreset(m.trigger.preset)?.group !== groupFilter) return false
      const stats = snapshot?.mappingsStats[m.id]
      const unresolved = !!snapshot?.unresolvedMappings[m.id]
      if (statusFilter === 'enabled' && !m.enabled) return false
      if (statusFilter === 'disabled' && m.enabled) return false
      if (statusFilter === 'fired' && !stats?.lastFiredAt) return false
      if (statusFilter === 'never' && stats?.lastFiredAt) return false
      if (statusFilter === 'problem' && !(unresolved || m.actions.length === 0)) return false
      if (q) {
        const s = q.toLowerCase()
        const hay = [
          m.name,
          m.category,
          summarizeTrigger(m.trigger.preset, m.trigger.params),
          ...m.trigger.simulatorNames,
          m.notes
        ]
          .join(' ')
          .toLowerCase()
        if (!hay.includes(s)) return false
      }
      return true
    })
  }, [profile, simFilter, catFilter, groupFilter, statusFilter, q, snapshot])

  if (!profile) return <></>
  const sceneName = (id: string): string => profile.scenes.find((s) => s.id === id)?.name ?? '?'
  const layerName = (id: string): string => profile.layers.find((l) => l.id === id)?.name ?? '?'

  const create = (simNames: string[] = simFilter && simFilter !== ANY ? [simFilter] : []): void => {
    const m: Mapping = {
      id: uuid(),
      name: `New mapping${simNames.length ? ' – ' + simNames.join(', ') : ''}`,
      enabled: true,
      category: catFilter || 'General',
      trigger: {
        preset: 'thorium.alertLevel',
        params: { levels: ['1'], includeInitial: true },
        conditions: [],
        simulatorNames: simNames
      },
      actions: profile.scenes[0]
        ? [
            {
              kind: 'activateScene',
              sceneId: profile.scenes[0].id,
              target: 'event',
              layerId: null,
              holdMsOverride: null
            }
          ]
        : [],
      debounceMs: 0,
      notes: ''
    }
    update((d) => ({ ...d, mappings: [...d.mappings, m] }))
    setEditing(m.id)
  }
  const duplicate = (m: Mapping): void => {
    const copy = {
      ...m,
      id: uuid(),
      name: `${m.name} copy`,
      trigger: { ...m.trigger, simulatorNames: [...m.trigger.simulatorNames] }
    }
    update((d) => ({ ...d, mappings: [...d.mappings, copy] }))
    setEditing(copy.id)
  }
  const remove = (m: Mapping): void => {
    const idx = profile.mappings.findIndex((x) => x.id === m.id)
    update((d) => ({ ...d, mappings: d.mappings.filter((x) => x.id !== m.id) }))
    toast('info', `Deleted "${m.name}"`, () =>
      update((d) => ({
        ...d,
        mappings: [...d.mappings.slice(0, idx), m, ...d.mappings.slice(idx)]
      }))
    )
    if (editing === m.id) setEditing(null)
  }
  const setEnabled = (ids: Set<string>, enabled: boolean): void =>
    update((d) => ({
      ...d,
      mappings: d.mappings.map((x) => (ids.has(x.id) ? { ...x, enabled } : x))
    }))
  const removeMany = (ids: Set<string>): void => {
    const removed = profile.mappings.filter((x) => ids.has(x.id))
    update((d) => ({ ...d, mappings: d.mappings.filter((x) => !ids.has(x.id)) }))
    setSelected(new Set())
    toast('info', `Deleted ${removed.length} mapping(s)`, () =>
      update((d) => ({ ...d, mappings: [...d.mappings, ...removed] }))
    )
  }
  /** Copy the selected mappings so each chosen simulator gets its own restricted variant. */
  const copyToSimulators = (targets: string[]): void => {
    const src = profile.mappings.filter((x) => selected.has(x.id))
    const copies: Mapping[] = []
    for (const m of src) {
      for (const sim of targets) {
        if (m.trigger.simulatorNames.length === 1 && eqIgnoreCase(m.trigger.simulatorNames[0], sim))
          continue
        copies.push({
          ...m,
          id: uuid(),
          name: `${m.name.replace(/\s+–\s+[^–]+$/, '')} – ${sim}`,
          trigger: { ...m.trigger, simulatorNames: [sim] }
        })
      }
    }
    update((d) => ({ ...d, mappings: [...d.mappings, ...copies] }))
    setCopyTarget(null)
    setSelected(new Set())
    toast(
      'success',
      `Created ${copies.length} simulator-specific mapping(s). Edit each one’s scene or values as needed.`
    )
  }
  const toggleSel = (id: string): void => {
    const n = new Set(selected)
    if (n.has(id)) n.delete(id)
    else n.add(id)
    setSelected(n)
  }
  const allVisibleSelected = filtered.length > 0 && filtered.every((m) => selected.has(m.id))

  if (editing) {
    const m = profile.mappings.find((x) => x.id === editing)
    if (!m) {
      setEditing(null)
      return <></>
    }
    return (
      <div className="max-w-6xl mx-auto">
        <PageHeader
          title={m.name || 'Untitled mapping'}
          subtitle="When the trigger matches an event, run the actions in order."
          actions={
            <Button icon={<ArrowLeft size={16} />} onClick={() => setEditing(null)}>
              Back to list
            </Button>
          }
        />
        <MappingEditor
          mapping={m}
          onChange={(next) =>
            update((d) => ({
              ...d,
              mappings: d.mappings.map((x) => (x.id === next.id ? next : x))
            }))
          }
        />
      </div>
    )
  }

  // Grouping
  const groups: { key: string; label: React.ReactNode; items: Mapping[] }[] = []
  if (groupBySim) {
    const anyItems = filtered.filter((m) => m.trigger.simulatorNames.length === 0)
    if (anyItems.length)
      groups.push({
        key: ANY,
        label: (
          <span className="inline-flex items-center gap-1.5">
            <Globe size={13} /> Any simulator
          </span>
        ),
        items: anyItems
      })
    const names = [...new Set(filtered.flatMap((m) => m.trigger.simulatorNames))].sort((a, b) =>
      a.localeCompare(b)
    )
    for (const n of names) {
      const items = filtered.filter((m) => m.trigger.simulatorNames.some((x) => eqIgnoreCase(x, n)))
      groups.push({
        key: n,
        label: (
          <span className="inline-flex items-center gap-1.5">
            <Ship size={13} /> {n}
          </span>
        ),
        items
      })
    }
  } else {
    groups.push({ key: 'all', label: null, items: filtered })
  }

  const row = (m: Mapping): React.JSX.Element => {
    const stats = snapshot?.mappingsStats[m.id]
    const missingScene = m.actions.some(
      (a) =>
        (a.kind === 'activateScene' || a.kind === 'releaseScene') &&
        !profile.scenes.some((s) => s.id === a.sceneId)
    )
    const unresolved = snapshot?.unresolvedMappings[m.id]
    const sims = m.trigger.simulatorNames
    return (
      <tr
        key={m.id}
        className={clsx(
          'border-t border-border hover:bg-surface-2 cursor-pointer',
          !m.enabled && 'opacity-60',
          selected.has(m.id) && 'bg-accent/5'
        )}
        onClick={() => setEditing(m.id)}
      >
        <td className="pl-4 pr-1 py-2.5 w-8" onClick={(e) => e.stopPropagation()}>
          <Checkbox checked={selected.has(m.id)} onChange={() => toggleSel(m.id)} label="" />
        </td>
        <td className="px-2 py-2.5 w-14" onClick={(e) => e.stopPropagation()}>
          <Switch checked={m.enabled} onChange={(v) => setEnabled(new Set([m.id]), v)} />
        </td>
        <td className="px-3 py-2.5">
          <div className="font-medium flex items-center gap-2">
            {m.name}
            {missingScene && (
              <span title="References a missing scene">
                <AlertTriangle size={14} className="text-warning" />
              </span>
            )}
            {unresolved && m.enabled && (
              <span title={unresolved}>
                <AlertTriangle size={14} className="text-danger" />
              </span>
            )}
            {m.actions.length === 0 && <Badge tone="warning">no actions</Badge>}
          </div>
          <div className="text-[12px] text-muted flex items-center gap-1.5 mt-0.5">
            <Badge>{m.category || 'General'}</Badge>
            {!groupBySim &&
              (sims.length ? (
                sims.map((s) => (
                  <Badge key={s} tone="accent">
                    {s}
                  </Badge>
                ))
              ) : (
                <Badge tone="muted">any simulator</Badge>
              ))}
          </div>
        </td>
        <td className="px-3 py-2.5 text-muted">
          {summarizeTrigger(m.trigger.preset, m.trigger.params)}
          {m.trigger.conditions.length > 0 && (
            <span className="text-faint"> +{m.trigger.conditions.length} cond.</span>
          )}
        </td>
        <td className="px-3 py-2.5 text-muted">
          {m.actions.map((a) => describeAction(a, sceneName, layerName)).join(' → ')}
        </td>
        <td className="px-3 py-2.5 text-muted whitespace-nowrap">
          {stats?.lastFiredAt ? formatAgo(stats.lastFiredAt) : 'never'}
          {stats?.count ? <span className="text-faint"> · {stats.count}×</span> : null}
        </td>
        <td className="px-4 py-2.5">
          <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
            <Button
              size="sm"
              variant="ghost"
              icon={<Copy size={13} />}
              onClick={() => duplicate(m)}
            />
            <InlineConfirm onConfirm={() => remove(m)} />
          </div>
        </td>
      </tr>
    )
  }

  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader
        title="Mappings"
        subtitle="Rules that turn Thorium, MQTT and UI events into lighting changes. Filter by simulator to work on one ship at a time."
        actions={
          <Button variant="primary" icon={<Plus size={16} />} onClick={() => create()}>
            New mapping{simFilter && simFilter !== ANY ? ` for ${simFilter}` : ''}
          </Button>
        }
      />
      <div className="flex items-center gap-3 mb-3">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'list', label: 'Rules', badge: <Badge>{profile.mappings.length}</Badge> },
            { value: 'simulate', label: 'Simulate' }
          ]}
        />
      </div>

      {tab === 'simulate' ? (
        <SimulatePanel />
      ) : profile.mappings.length === 0 ? (
        <EmptyState
          icon={<GitBranch size={28} />}
          title="No mappings yet"
          body="Create a mapping, or open the Thorium event inspector and press “Create mapping from this event” on any row."
          action={
            <Button variant="primary" icon={<Plus size={16} />} onClick={() => create()}>
              New mapping
            </Button>
          }
        />
      ) : (
        <>
          <div className="card px-3 py-2.5 mb-3 flex items-center gap-2 flex-wrap">
            <SearchInput
              value={q}
              onChange={setQ}
              placeholder="Search name, trigger, notes…"
              className="w-64"
            />
            <Select
              value={simFilter}
              onChange={setSimFilter}
              className="w-52"
              options={[
                { value: '', label: 'All simulators' },
                { value: ANY, label: 'Rules for any simulator' },
                ...simulatorNames.map((n) => ({ value: n, label: `Only ${n}` }))
              ]}
            />
            <Select
              value={catFilter}
              onChange={setCatFilter}
              className="w-44"
              options={[
                { value: '', label: 'All categories' },
                ...categories.map((c) => ({ value: c, label: c }))
              ]}
            />
            <Select
              value={groupFilter}
              onChange={setGroupFilter}
              className="w-40"
              options={[
                { value: '', label: 'All triggers' },
                ...PRESET_GROUPS.map((g) => ({ value: g, label: g }))
              ]}
            />
            <Select
              value={statusFilter}
              onChange={setStatusFilter}
              className="w-44"
              options={[
                { value: '', label: 'Any status' },
                { value: 'enabled', label: 'Enabled' },
                { value: 'disabled', label: 'Disabled' },
                { value: 'fired', label: 'Has fired' },
                { value: 'never', label: 'Never fired' },
                { value: 'problem', label: 'Needs attention' }
              ]}
            />
            <span className="ml-auto flex items-center gap-3 text-[12px] text-muted">
              <Switch
                checked={groupBySim}
                onChange={setGroupBySim}
                label={
                  <span className="inline-flex items-center gap-1">
                    <Layers size={13} /> Group by simulator
                  </span>
                }
              />
              <span>
                {filtered.length} of {profile.mappings.length}
              </span>
            </span>
          </div>

          {selected.size > 0 && (
            <div className="card px-3 py-2 mb-3 flex items-center gap-2 bg-accent/5 border-accent/30">
              <span className="text-[13px] font-medium">{selected.size} selected</span>
              <Button size="sm" onClick={() => setEnabled(selected, true)}>
                Enable
              </Button>
              <Button size="sm" onClick={() => setEnabled(selected, false)}>
                Disable
              </Button>
              <Button size="sm" icon={<Ship size={13} />} onClick={() => setCopyTarget([])}>
                Copy to simulators…
              </Button>
              <InlineConfirm
                label="Delete"
                question={`Delete ${selected.size}?`}
                icon={<Trash2 size={13} />}
                onConfirm={() => removeMany(selected)}
              />
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto"
                onClick={() => setSelected(new Set())}
              >
                Clear selection
              </Button>
            </div>
          )}

          {filtered.length === 0 ? (
            <EmptyState
              title="No mappings match these filters"
              body="Clear a filter, or create a new mapping for the selected simulator."
              action={
                <Button variant="primary" icon={<Plus size={16} />} onClick={() => create()}>
                  New mapping
                </Button>
              }
            />
          ) : (
            <div className="card overflow-hidden">
              <table className="w-full text-[13px]">
                <thead className="bg-surface-2 text-muted text-[12px] uppercase tracking-wider">
                  <tr>
                    <th className="pl-4 pr-1 py-2.5 w-8" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={allVisibleSelected}
                        onChange={(v) =>
                          setSelected(v ? new Set(filtered.map((m) => m.id)) : new Set())
                        }
                        label=""
                      />
                    </th>
                    <th className="px-2 py-2.5 w-14" />
                    <th className="text-left font-semibold px-3 py-2.5">Mapping</th>
                    <th className="text-left font-semibold px-3 py-2.5">When</th>
                    <th className="text-left font-semibold px-3 py-2.5">Then</th>
                    <th className="text-left font-semibold px-3 py-2.5">Last fired</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => (
                    <React.Fragment key={g.key}>
                      {g.label && (
                        <tr className="bg-surface-2/60">
                          <td
                            colSpan={7}
                            className="px-4 py-1.5 text-[12px] font-semibold uppercase tracking-wider text-muted"
                          >
                            <span className="inline-flex items-center gap-3">
                              {g.label}
                              <span className="text-faint normal-case tracking-normal font-normal">
                                {g.items.length} rule{g.items.length === 1 ? '' : 's'}
                              </span>
                              {g.key !== ANY && (
                                <button
                                  className="text-accent normal-case tracking-normal font-medium"
                                  onClick={() => create([g.key])}
                                >
                                  + add for {g.key}
                                </button>
                              )}
                            </span>
                          </td>
                        </tr>
                      )}
                      {g.items.map(row)}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <Modal
        open={copyTarget !== null}
        onClose={() => setCopyTarget(null)}
        title={`Copy ${selected.size} mapping(s) to simulators`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setCopyTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!copyTarget?.length}
              onClick={() => copyTarget && copyToSimulators(copyTarget)}
            >
              Create copies
            </Button>
          </>
        }
      >
        <div className="text-[13px] text-muted mb-3">
          Each selected mapping is duplicated once per chosen simulator, restricted to that
          simulator. Use this to start from a shared rule and then tune each ship separately.
        </div>
        <SimulatorChips
          value={copyTarget ?? []}
          onChange={(v) => setCopyTarget(v.length ? v : [])}
        />
        {copyTarget?.length === 0 && (
          <div className="text-[12px] text-faint mt-2">
            Pick at least one simulator (the “Any simulator” chip is not a target here).
          </div>
        )}
      </Modal>
    </div>
  )
}
