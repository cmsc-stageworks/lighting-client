import React, { useMemo } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import type { Condition } from '@shared/types/config'
import { CONDITION_OP_LABELS } from '@shared/triggers/conditions'
import { useEvents } from '../../store/events'
import { Button, Input, Select } from '../../components/ui'

const OPS = Object.keys(CONDITION_OP_LABELS) as Condition['op'][]

/** Collect dot-paths from recent events with the given name (for autocomplete). */
function collectPaths(
  obj: unknown,
  prefix = '',
  out: Set<string> = new Set(),
  depth = 0
): Set<string> {
  if (depth > 4 || obj == null || typeof obj !== 'object') return out
  if (Array.isArray(obj)) {
    if (obj.length) collectPaths(obj[0], `${prefix}[]`, out, depth + 1)
    return out
  }
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const p = prefix ? `${prefix}.${k}` : k
    out.add(p)
    collectPaths(v, p, out, depth + 1)
  }
  return out
}

export function ConditionBuilder({
  conditions,
  onChange,
  eventName,
  eventType
}: {
  conditions: Condition[]
  onChange: (c: Condition[]) => void
  eventName?: string
  eventType?: string
}): React.JSX.Element {
  const events = useEvents((s) => s.events)
  const paths = useMemo(() => {
    const set = new Set<string>()
    const sample = events
      .filter((e) => (!eventType || e.type === eventType) && (!eventName || e.name === eventName))
      .slice(-20)
    for (const e of sample) collectPaths(e.data, '', set)
    return [...set].sort()
  }, [events, eventName, eventType])
  const listId = 'cond-paths'

  const setAt = (i: number, p: Partial<Condition>): void =>
    onChange(conditions.map((c, k) => (k === i ? { ...c, ...p } : c)))

  return (
    <div className="flex flex-col gap-2">
      {conditions.length === 0 && (
        <div className="text-[13px] text-faint">
          No extra conditions. The trigger’s own settings decide when it fires.
        </div>
      )}
      {conditions.map((c, i) => {
        const needsValue = c.op !== 'exists' && c.op !== 'notExists'
        return (
          <div key={i} className="flex items-center gap-2">
            <span className="text-[12px] text-faint w-8 text-right">{i === 0 ? 'if' : 'and'}</span>
            <Input
              value={c.path}
              onChange={(e) => setAt(i, { path: e.target.value })}
              placeholder="path, e.g. alertLevel or json.level"
              className="mono !w-56"
              list={listId}
            />
            <Select
              value={c.op}
              onChange={(v) => setAt(i, { op: v as Condition['op'] })}
              options={OPS.map((o) => ({ value: o, label: CONDITION_OP_LABELS[o] }))}
              className="w-44"
            />
            {needsValue && (
              <Input
                value={c.value == null ? '' : String(c.value)}
                onChange={(e) => setAt(i, { value: coerce(e.target.value) })}
                placeholder="value"
                className="mono !w-44"
              />
            )}
            <Button
              size="sm"
              variant="ghost"
              icon={<Trash2 size={13} />}
              onClick={() => onChange(conditions.filter((_, k) => k !== i))}
            />
          </div>
        )
      })}
      <div>
        <Button
          size="sm"
          icon={<Plus size={13} />}
          onClick={() => onChange([...conditions, { path: '', op: 'eq', value: '' }])}
        >
          Add condition
        </Button>
      </div>
      <datalist id={listId}>
        {paths.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>
    </div>
  )
}

function coerce(s: string): string | number | boolean {
  if (s === 'true') return true
  if (s === 'false') return false
  if (s.trim() !== '' && !Number.isNaN(Number(s)) && /^-?\d+(\.\d+)?$/.test(s.trim()))
    return Number(s)
  return s
}
