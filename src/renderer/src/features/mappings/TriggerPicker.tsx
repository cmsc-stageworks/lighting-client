import React, { useMemo, useState } from 'react'
import clsx from 'clsx'
import type { Trigger } from '@shared/types/config'
import {
  getPreset,
  listPresets,
  PRESET_GROUPS,
  type FieldDescriptor
} from '@shared/triggers/catalog'
import { useRuntime } from '../../store/runtime'
import { useConfig } from '../../store/config'
import { Field, Input, NumberInput, SearchInput, Select, Switch } from '../../components/ui'

export function TriggerPicker({
  value,
  onChange
}: {
  value: Trigger
  onChange: (t: Trigger) => void
}): React.JSX.Element {
  const [q, setQ] = useState('')
  const presets = listPresets()
  const filtered = useMemo(
    () =>
      presets.filter(
        (p) =>
          !q ||
          p.label.toLowerCase().includes(q.toLowerCase()) ||
          p.description.toLowerCase().includes(q.toLowerCase()) ||
          p.group.toLowerCase().includes(q.toLowerCase())
      ),
    [presets, q]
  )
  const current = getPreset(value.preset)

  return (
    <div className="grid grid-cols-[260px_1fr] gap-4">
      <div className="card p-2 max-h-[420px] overflow-y-auto">
        <SearchInput value={q} onChange={setQ} placeholder="Find a trigger…" className="mb-2" />
        {PRESET_GROUPS.map((g) => {
          const items = filtered.filter((p) => p.group === g)
          if (!items.length) return null
          return (
            <div key={g} className="mb-2">
              <div className="text-[11px] font-bold uppercase tracking-wider text-faint px-2 py-1">
                {g}
              </div>
              {items.map((p) => (
                <button
                  key={p.key}
                  onClick={() => onChange({ ...value, preset: p.key, params: { ...p.defaults } })}
                  className={clsx(
                    'w-full text-left px-2 py-1.5 rounded-lg text-[13px]',
                    value.preset === p.key
                      ? 'bg-accent/15 text-accent font-medium'
                      : 'hover:bg-surface-2'
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          )
        })}
      </div>
      <div>
        {current ? (
          <>
            <div className="font-semibold">{current.label}</div>
            <div className="text-muted text-[13px] mb-3">{current.description}</div>
            {current.fields.length === 0 ? (
              <div className="text-[13px] text-faint">No settings for this trigger.</div>
            ) : (
              <div className="flex flex-col gap-3">
                {current.fields.map((f) => (
                  <PresetField
                    key={f.key}
                    field={f}
                    value={value.params[f.key]}
                    onChange={(v) =>
                      onChange({ ...value, params: { ...value.params, [f.key]: v } })
                    }
                  />
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="text-muted">Choose a trigger from the list.</div>
        )}
      </div>
    </div>
  )
}

function PresetField({
  field,
  value,
  onChange
}: {
  field: FieldDescriptor
  value: unknown
  onChange: (v: unknown) => void
}): React.JSX.Element {
  const refData = useRuntime((s) => s.refData)
  const profile = useConfig((s) => s.draft)
  const listId = `ac-${field.key}-${field.kind === 'text' ? (field.autocomplete ?? 'none') : 'x'}`
  const suggestions = useMemo(() => {
    if (field.kind !== 'text' || !field.autocomplete) return []
    switch (field.autocomplete) {
      case 'eventName':
        return [
          ...refData.seenEventNames,
          ...refData.knownEventNames.filter((n) => !refData.seenEventNames.includes(n))
        ]
      case 'macroName':
        return refData.macros.map((m) => m.name)
      case 'buttonName':
        return refData.macroButtonConfigs.flatMap((c) => c.buttons.map((b) => b.name))
      case 'missionName':
        return refData.missions.map((m) => m.name)
      case 'systemName':
        return []
      default:
        return []
    }
  }, [field, refData])
  void profile
  switch (field.kind) {
    case 'text':
      return (
        <Field label={field.label} hint={field.help}>
          <Input
            value={String(value ?? '')}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.placeholder}
            list={suggestions.length ? listId : undefined}
            className={field.autocomplete === 'eventName' ? 'mono' : undefined}
          />
          {suggestions.length > 0 && (
            <datalist id={listId}>
              {suggestions.slice(0, 400).map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          )}
        </Field>
      )
    case 'number':
      return (
        <Field label={field.label} hint={field.help}>
          <NumberInput
            value={Number(value ?? 0)}
            min={field.min}
            max={field.max}
            step={field.step}
            onChange={onChange}
            className="!w-40"
          />
        </Field>
      )
    case 'boolean':
      return (
        <Field label={field.label} hint={field.help}>
          <Switch checked={!!value} onChange={onChange} label={value ? 'Yes' : 'No'} />
        </Field>
      )
    case 'select':
      return (
        <Field label={field.label} hint={field.help}>
          <Select
            value={String(value ?? '')}
            onChange={onChange}
            options={field.options}
            className="w-72"
          />
        </Field>
      )
    case 'multiselect': {
      const arr = Array.isArray(value) ? (value as string[]) : []
      return (
        <Field label={field.label} hint={field.help}>
          <div className="flex flex-wrap gap-1.5">
            {field.options.map((o) => {
              const on = arr.includes(o.value)
              return (
                <button
                  key={o.value}
                  onClick={() =>
                    onChange(on ? arr.filter((x) => x !== o.value) : [...arr, o.value])
                  }
                  className={clsx(
                    'h-8 px-3 rounded-full border text-[13px]',
                    on
                      ? 'bg-accent/20 text-accent border-accent/40 font-medium'
                      : 'bg-surface-2 text-muted border-border'
                  )}
                >
                  {o.label}
                </button>
              )
            })}
          </div>
        </Field>
      )
    }
  }
}
