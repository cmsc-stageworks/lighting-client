import React, { useMemo } from 'react'
import clsx from 'clsx'
import { Globe, Ship } from 'lucide-react'
import type { Mapping } from '@shared/types/config'
import { getPreset, summarizeTrigger } from '@shared/triggers/catalog'
import { eqIgnoreCase } from '@shared/utils'
import { useConfig } from '../../store/config'
import { useRuntime } from '../../store/runtime'
import {
  Callout,
  Card,
  Field,
  Input,
  NumberInput,
  SectionTitle,
  Switch,
  TextArea
} from '../../components/ui'
import { TriggerPicker } from './TriggerPicker'
import { ConditionBuilder } from './ConditionBuilder'
import { ActionsEditor } from './ActionsEditor'

/** Simulator chips: "Any" or a multi-select of known names (profiles ∪ live flight ∪ already used). */
export function SimulatorChips({
  value,
  onChange,
  compact
}: {
  value: string[]
  onChange: (names: string[]) => void
  compact?: boolean
}): React.JSX.Element {
  const profile = useConfig((s) => s.draft)
  const inScope = useRuntime((s) => s.snapshot?.thorium.simulatorsInScope)
  const refSims = useRuntime((s) => s.refData.simulators)
  const names = useMemo(() => {
    const out: string[] = []
    const add = (n: string): void => {
      if (n && !out.some((x) => eqIgnoreCase(x, n))) out.push(n)
    }
    for (const s of profile?.simulators ?? []) add(s.name)
    for (const s of inScope ?? []) add(s.name)
    for (const s of refSims) add(s.name)
    for (const m of profile?.mappings ?? []) for (const n of m.trigger.simulatorNames) add(n)
    for (const n of value) add(n)
    return out
  }, [profile, inScope, refSims, value])
  const any = value.length === 0
  const toggle = (n: string): void =>
    onChange(
      value.some((x) => eqIgnoreCase(x, n))
        ? value.filter((x) => !eqIgnoreCase(x, n))
        : [...value, n]
    )
  const chip = (on: boolean): string =>
    clsx(
      'rounded-full border font-medium inline-flex items-center gap-1.5 transition-colors',
      compact ? 'h-7 px-2.5 text-[12px]' : 'h-9 px-3.5 text-[13px]',
      on
        ? 'bg-accent/20 text-accent border-accent/40'
        : 'bg-surface-2 text-muted border-border hover:text-text'
    )
  return (
    <div className="flex flex-wrap gap-2 items-center">
      <button className={chip(any)} onClick={() => onChange([])}>
        <Globe size={compact ? 12 : 14} /> Any simulator in scope
      </button>
      {names.map((n) => (
        <button
          key={n}
          className={chip(value.some((x) => eqIgnoreCase(x, n)))}
          onClick={() => toggle(n)}
        >
          <Ship size={compact ? 12 : 14} /> {n}
        </button>
      ))}
      {!compact && (
        <Input
          placeholder="Other name + Enter"
          className="!h-9 !w-44"
          onKeyDown={(e) => {
            const v = (e.target as HTMLInputElement).value.trim()
            if (e.key === 'Enter' && v) {
              toggle(v)
              ;(e.target as HTMLInputElement).value = ''
            }
          }}
        />
      )}
    </div>
  )
}

export function MappingEditor({
  mapping,
  onChange
}: {
  mapping: Mapping
  onChange: (m: Mapping) => void
}): React.JSX.Element {
  const profile = useConfig((s) => s.draft)!
  const dirty = useConfig((s) => s.dirty)
  const unresolved = useRuntime((s) => s.snapshot?.unresolvedMappings[mapping.id])
  const preset = getPreset(mapping.trigger.preset)
  const eventName =
    mapping.trigger.preset === 'custom.event'
      ? String(mapping.trigger.params.eventName ?? '')
      : undefined
  const eventType = preset
    ? preset.compile({ ...preset.defaults, ...mapping.trigger.params }, { refData: null }).types[0]
    : undefined
  const categories = useMemo(
    () => [...new Set(profile.mappings.map((m) => m.category || 'General'))].sort(),
    [profile.mappings]
  )
  const sims = mapping.trigger.simulatorNames

  return (
    <div className="flex flex-col gap-4">
      {unresolved && !dirty && mapping.enabled && (
        <Callout tone="danger">This mapping cannot fire right now: {unresolved}</Callout>
      )}
      <Card>
        <div className="grid grid-cols-[1fr_220px_auto_auto] gap-4 items-end">
          <Field label="Name">
            <Input
              value={mapping.name}
              onChange={(e) => onChange({ ...mapping, name: e.target.value })}
            />
          </Field>
          <Field label="Category" hint="For filtering and grouping">
            <Input
              value={mapping.category}
              onChange={(e) => onChange({ ...mapping, category: e.target.value })}
              list="mapping-categories"
            />
            <datalist id="mapping-categories">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>
          <Field label="Debounce (ms)" hint="Ignore repeats within">
            <NumberInput
              value={mapping.debounceMs}
              min={0}
              step={50}
              onChange={(v) => onChange({ ...mapping, debounceMs: v })}
              className="!w-32"
            />
          </Field>
          <Field label="Enabled">
            <div className="h-10 flex items-center">
              <Switch
                checked={mapping.enabled}
                onChange={(v) => onChange({ ...mapping, enabled: v })}
              />
            </div>
          </Field>
        </div>
        <div className="mt-4 pt-4 border-t border-border">
          <div className="field-label">Applies to</div>
          <SimulatorChips
            value={sims}
            onChange={(names) =>
              onChange({ ...mapping, trigger: { ...mapping.trigger, simulatorNames: names } })
            }
          />
          <div className="text-[12px] text-faint mt-2">
            {sims.length === 0
              ? 'Fires for events from every simulator this instance follows. Scene actions target the event’s simulator, so one rule can serve all ships.'
              : `Only events from ${sims.join(', ')} match. Events with no simulator (flight-level, MQTT) never match a simulator-restricted mapping.`}
          </div>
        </div>
      </Card>

      <Card>
        <SectionTitle>1 · When</SectionTitle>
        <TriggerPicker
          value={mapping.trigger}
          onChange={(t) => onChange({ ...mapping, trigger: t })}
        />
        <div className="mt-4 pt-4 border-t border-border">
          <div className="field-label">Extra conditions on the event data</div>
          <ConditionBuilder
            conditions={mapping.trigger.conditions}
            onChange={(c) =>
              onChange({ ...mapping, trigger: { ...mapping.trigger, conditions: c } })
            }
            eventName={eventName}
            eventType={eventType}
          />
        </div>
        <div className="mt-3 text-[13px] text-muted">
          Summary:{' '}
          <span className="text-text">
            {summarizeTrigger(mapping.trigger.preset, mapping.trigger.params)}
          </span>
          {mapping.trigger.conditions.length > 0 && (
            <span> + {mapping.trigger.conditions.length} condition(s)</span>
          )}
          <span> · {sims.length ? sims.join(', ') : 'any simulator'}</span>
        </div>
      </Card>

      <Card>
        <SectionTitle>2 · Then</SectionTitle>
        <ActionsEditor
          actions={mapping.actions}
          onChange={(a) => onChange({ ...mapping, actions: a })}
        />
      </Card>

      <Card>
        <Field label="Notes">
          <TextArea
            value={mapping.notes}
            onChange={(e) => onChange({ ...mapping, notes: e.target.value })}
            rows={2}
          />
        </Field>
      </Card>
    </div>
  )
}
