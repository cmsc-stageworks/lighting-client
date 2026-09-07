import React, { useMemo } from 'react'
import { Plus, Trash2, GitBranch } from 'lucide-react'
import type { Condition, ConditionNode } from '@shared/types/config'
import { CONDITION_OP_LABELS, isConditionGroup } from '@shared/triggers/conditions'
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

const blankLeaf = (): Condition => ({ path: '', op: 'eq', value: '' })

export function ConditionBuilder({
  conditions,
  onChange,
  eventName,
  eventType
}: {
  conditions: ConditionNode[]
  onChange: (c: ConditionNode[]) => void
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

  const setNode = (i: number, node: ConditionNode): void =>
    onChange(conditions.map((n, k) => (k === i ? node : n)))
  const removeNode = (i: number): void => onChange(conditions.filter((_, k) => k !== i))

  return (
    <div className="flex flex-col gap-2">
      {conditions.length === 0 && (
        <div className="text-[13px] text-faint">
          No extra conditions. The trigger’s own settings decide when it fires.
        </div>
      )}
      {conditions.map((node, i) => {
        const prefix = i === 0 ? 'if' : 'and'
        if (isConditionGroup(node)) {
          return (
            <GroupRow
              key={i}
              prefix={prefix}
              group={node}
              listId={listId}
              onChange={(g) => setNode(i, g)}
              onRemove={() => removeNode(i)}
            />
          )
        }
        return (
          <LeafRow
            key={i}
            prefix={prefix}
            leaf={node}
            listId={listId}
            onChange={(c) => setNode(i, c)}
            onRemove={() => removeNode(i)}
            onWrapInGroup={() => setNode(i, { any: [node, blankLeaf()] })}
          />
        )
      })}
      <div className="flex gap-2">
        <Button
          size="sm"
          icon={<Plus size={13} />}
          onClick={() => onChange([...conditions, blankLeaf()])}
        >
          Add condition
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={<GitBranch size={13} />}
          title="OR between two fields of the same event. To fire on two different events, add another trigger above instead."
          onClick={() => onChange([...conditions, { any: [blankLeaf(), blankLeaf()] }])}
        >
          Add “any of” group
        </Button>
      </div>
      <div className="text-[12px] text-faint">
        Conditions narrow <em>this</em> trigger and are ANDed. To fire on a different event as well,
        use “Add another trigger (or)” above.
      </div>
      <datalist id={listId}>
        {paths.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>
    </div>
  )
}

function LeafFields({
  leaf,
  listId,
  onChange
}: {
  leaf: Condition
  listId: string
  onChange: (c: Condition) => void
}): React.JSX.Element {
  const needsValue = leaf.op !== 'exists' && leaf.op !== 'notExists'
  return (
    <>
      <Input
        value={leaf.path}
        onChange={(e) => onChange({ ...leaf, path: e.target.value })}
        placeholder="path, e.g. alertLevel or json.level"
        className="mono !w-56"
        list={listId}
      />
      <Select
        value={leaf.op}
        onChange={(v) => onChange({ ...leaf, op: v as Condition['op'] })}
        options={OPS.map((o) => ({ value: o, label: CONDITION_OP_LABELS[o] }))}
        className="w-44"
      />
      {needsValue && (
        <Input
          value={leaf.value == null ? '' : String(leaf.value)}
          onChange={(e) => onChange({ ...leaf, value: coerce(e.target.value) })}
          placeholder={leaf.op === 'regex' ? 'pattern — anchor with ^…$ for exact' : 'value'}
          className="mono !w-44"
        />
      )}
    </>
  )
}

function LeafRow({
  prefix,
  leaf,
  listId,
  onChange,
  onRemove,
  onWrapInGroup
}: {
  prefix: string
  leaf: Condition
  listId: string
  onChange: (c: Condition) => void
  onRemove: () => void
  onWrapInGroup: () => void
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[12px] text-faint w-8 text-right">{prefix}</span>
      <LeafFields leaf={leaf} listId={listId} onChange={onChange} />
      <Button
        size="sm"
        variant="ghost"
        title="Turn this into an “any of” group"
        icon={<GitBranch size={13} />}
        onClick={onWrapInGroup}
      />
      <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} onClick={onRemove} />
    </div>
  )
}

function GroupRow({
  prefix,
  group,
  listId,
  onChange,
  onRemove
}: {
  prefix: string
  group: { any: Condition[] }
  listId: string
  onChange: (n: ConditionNode) => void
  onRemove: () => void
}): React.JSX.Element {
  const setLeaf = (i: number, c: Condition): void =>
    onChange({ any: group.any.map((x, k) => (k === i ? c : x)) })
  const removeLeaf = (i: number): void => {
    const next = group.any.filter((_, k) => k !== i)
    // A group with a single leaf is just that leaf.
    onChange(next.length === 1 ? next[0] : { any: next })
  }
  return (
    <div className="flex items-start gap-2">
      <span className="text-[12px] text-faint w-8 text-right mt-2">{prefix}</span>
      <div className="flex-1 rounded-md border border-border bg-surface/40 p-2 flex flex-col gap-2">
        <div className="text-[11px] uppercase tracking-wide text-faint">any of</div>
        {group.any.map((leaf, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="text-[12px] text-faint w-8 text-right">{i === 0 ? '' : 'or'}</span>
            <LeafFields leaf={leaf} listId={listId} onChange={(c) => setLeaf(i, c)} />
            <Button
              size="sm"
              variant="ghost"
              icon={<Trash2 size={13} />}
              onClick={() => removeLeaf(i)}
            />
          </div>
        ))}
        <div>
          <Button
            size="sm"
            variant="ghost"
            icon={<Plus size={13} />}
            onClick={() => onChange({ any: [...group.any, blankLeaf()] })}
          >
            Add alternative
          </Button>
        </div>
      </div>
      <Button
        size="sm"
        variant="ghost"
        title="Remove this group"
        icon={<Trash2 size={13} />}
        onClick={onRemove}
      />
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
