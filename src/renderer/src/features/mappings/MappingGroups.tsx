import React from 'react'
import clsx from 'clsx'
import { Layers3, Plus } from 'lucide-react'
import type { MappingGroup } from '@shared/types/config'
import { uuid } from '@shared/utils'
import { useConfig } from '../../store/config'
import { useRuntime } from '../../store/runtime'
import { Button, InlineConfirm, Input, Modal } from '../../components/ui'

const GROUP_COLORS = ['#a78bfa', '#f472b6', '#4cc9f0', '#3ddc97', '#ffe066', '#ffb454']

/** A group name with its colour dot. */
export function GroupBadge({
  group,
  active
}: {
  group: Pick<MappingGroup, 'name' | 'color'>
  active?: boolean
}): React.JSX.Element {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full border px-2 h-5 text-[11px] font-medium whitespace-nowrap',
        active ? 'border-accent/40 text-text' : 'border-border text-muted'
      )}
      title={active ? 'Active group' : undefined}
    >
      <span className="size-2 rounded-full" style={{ background: group.color }} />
      {group.name}
    </span>
  )
}

/** Multi-select of mapping groups; empty = "every group". */
export function GroupChips({
  value,
  onChange
}: {
  value: string[]
  onChange: (ids: string[]) => void
}): React.JSX.Element {
  const groups = useConfig((s) => s.draft?.mappingGroups)
  const chip = (on: boolean): string =>
    clsx(
      'rounded-full border font-medium inline-flex items-center gap-1.5 transition-colors h-9 px-3.5 text-[13px]',
      on
        ? 'bg-accent/20 text-accent border-accent/40'
        : 'bg-surface-2 text-muted border-border hover:text-text'
    )
  const toggle = (id: string): void =>
    onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id])
  return (
    <div className="flex flex-wrap gap-2 items-center">
      <button className={chip(value.length === 0)} onClick={() => onChange([])}>
        <Layers3 size={14} /> Every group
      </button>
      {(groups ?? []).map((g) => (
        <button key={g.id} className={chip(value.includes(g.id))} onClick={() => toggle(g.id)}>
          <span className="size-2.5 rounded-full" style={{ background: g.color }} />
          {g.name}
        </button>
      ))}
    </div>
  )
}

/** Add, rename, recolour and delete the profile's mapping groups. */
export function MappingGroupsModal({
  open,
  onClose
}: {
  open: boolean
  onClose: () => void
}): React.JSX.Element {
  const profile = useConfig((s) => s.draft)
  const update = useConfig((s) => s.update)
  const activeId = useRuntime((s) => s.snapshot?.mappingGroup.activeId ?? null)
  const groups = profile?.mappingGroups ?? []
  const count = (id: string): number =>
    (profile?.mappings ?? []).filter((m) => m.groupIds.includes(id)).length

  const add = (): void =>
    update((d) => ({
      ...d,
      mappingGroups: [
        ...d.mappingGroups,
        {
          id: uuid(),
          name: `Group ${d.mappingGroups.length + 1}`,
          color: GROUP_COLORS[d.mappingGroups.length % GROUP_COLORS.length]
        }
      ]
    }))
  const patch = (id: string, p: Partial<MappingGroup>): void =>
    update((d) => ({
      ...d,
      mappingGroups: d.mappingGroups.map((g) => (g.id === id ? { ...g, ...p } : g))
    }))
  const remove = (id: string): void =>
    update((d) => ({
      ...d,
      mappingGroups: d.mappingGroups.filter((g) => g.id !== id),
      // Membership goes with the group; a mapping left in no group fires in every group.
      mappings: d.mappings.map((m) =>
        m.groupIds.includes(id) ? { ...m, groupIds: m.groupIds.filter((g) => g !== id) } : m
      )
    }))

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Mapping groups"
      footer={
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <div className="text-[13px] text-muted mb-4">
        A group is a switchable set of mappings — for example two different desk looks for the same
        alert levels. Staff pick the active group in the top bar or the tray menu, or a mapping can
        switch it with a “Switch mapping group” action. Only mappings in the active group fire;
        mappings in no group fire in every group. The first group is active until someone picks
        another.
      </div>
      <div className="flex flex-col gap-2">
        {groups.map((g) => (
          <div key={g.id} className="flex items-center gap-3">
            <input
              type="color"
              value={g.color}
              onChange={(e) => patch(g.id, { color: e.target.value })}
              className="h-9 w-10 rounded-md border border-border bg-surface-2 p-1 cursor-pointer shrink-0"
              aria-label={`Colour of ${g.name}`}
            />
            <Input
              value={g.name}
              onChange={(e) => patch(g.id, { name: e.target.value })}
              className="grow"
            />
            <span className="text-[12px] text-faint whitespace-nowrap w-24">
              {count(g.id)} mapping{count(g.id) === 1 ? '' : 's'}
            </span>
            <span className="text-[12px] text-accent w-12">
              {activeId === g.id ? 'active' : ''}
            </span>
            <InlineConfirm question="Delete group?" onConfirm={() => remove(g.id)} />
          </div>
        ))}
        {groups.length === 0 && (
          <div className="text-[13px] text-faint">No groups — every mapping fires.</div>
        )}
      </div>
      <Button className="mt-4" icon={<Plus size={14} />} onClick={add}>
        Add group
      </Button>
      <div className="text-[12px] text-faint mt-3">
        Changes take effect when you save the profile.
      </div>
    </Modal>
  )
}
