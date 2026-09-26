import type { Mapping, MappingGroup } from './schema/config.schema'

/**
 * Mapping groups: staff pick one active group, and only mappings in it (plus
 * ungrouped mappings) fire. Pure so the engine and the renderer agree.
 */

/**
 * The group that is actually active: the saved choice if it still exists,
 * otherwise the first group. Null when the profile has no groups, which means
 * every mapping fires.
 */
export function resolveActiveGroup(groups: MappingGroup[], savedId: string | null): string | null {
  if (groups.length === 0) return null
  return groups.some((g) => g.id === savedId) ? savedId : groups[0].id
}

/** Whether a mapping takes part while `activeGroupId` is active. */
export function mappingInGroup(
  mapping: Pick<Mapping, 'groupIds'>,
  activeGroupId: string | null
): boolean {
  return (
    activeGroupId == null ||
    mapping.groupIds.length === 0 ||
    mapping.groupIds.includes(activeGroupId)
  )
}
