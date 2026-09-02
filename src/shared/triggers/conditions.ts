import type { Condition } from '../schema/config.schema'
import { globToRegExp, resolvePath } from '../utils'

const regexCache = new Map<string, RegExp | null>()

function getRegex(pattern: string, glob: boolean): RegExp | null {
  const key = (glob ? 'g:' : 'r:') + pattern
  if (regexCache.has(key)) return regexCache.get(key) ?? null
  let re: RegExp | null = null
  try {
    re = glob ? globToRegExp(pattern) : new RegExp(pattern, 'i')
  } catch {
    re = null
  }
  regexCache.set(key, re)
  return re
}

/** Loose equality: "1" == 1, "true" == true, case-insensitive strings. */
export function looseEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a == null || b == null) return false
  if (typeof a === 'string' && typeof b === 'string') return a.toLowerCase() === b.toLowerCase()
  if (typeof a === 'number' || typeof b === 'number') {
    const na = Number(a)
    const nb = Number(b)
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na === nb
  }
  if (typeof a === 'boolean' || typeof b === 'boolean') {
    return String(a).toLowerCase() === String(b).toLowerCase()
  }
  return String(a) === String(b)
}

function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return v
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isNaN(n) ? null : n
  }
  return null
}

/**
 * Evaluate a single condition against event data. When the path contains `[]`
 * the resolved value is an array and the condition passes if ANY element passes
 * (for positive operators) — this is what users expect from "macros[].stepId eq X".
 */
export function evalCondition(c: Condition, data: unknown): boolean {
  const { found, value } = resolvePath(data, c.path)
  const hasAny = c.path.includes('[]')

  if (c.op === 'exists') return found && value !== undefined && value !== null
  if (c.op === 'notExists') return !found || value === undefined || value === null
  if (!found) return c.op === 'neq'

  if (hasAny && Array.isArray(value)) {
    if (c.op === 'neq') return value.every((v) => evalScalar(c, v))
    return value.some((v) => evalScalar(c, v))
  }
  return evalScalar(c, value)
}

function evalScalar(c: Condition, value: unknown): boolean {
  const expected = c.value
  switch (c.op) {
    case 'eq':
      return looseEquals(value, expected)
    case 'neq':
      return !looseEquals(value, expected)
    case 'contains': {
      if (Array.isArray(value)) return value.some((v) => looseEquals(v, expected))
      if (value == null) return false
      return String(value)
        .toLowerCase()
        .includes(String(expected ?? '').toLowerCase())
    }
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const a = toNumber(value)
      const b = toNumber(expected)
      if (a == null || b == null) return false
      if (c.op === 'gt') return a > b
      if (c.op === 'gte') return a >= b
      if (c.op === 'lt') return a < b
      return a <= b
    }
    case 'regex': {
      const re = getRegex(String(expected ?? ''), false)
      return !!re && re.test(String(value ?? ''))
    }
    case 'glob': {
      const re = getRegex(String(expected ?? ''), true)
      return !!re && re.test(String(value ?? ''))
    }
    default:
      return false
  }
}

export function evalConditions(conditions: Condition[], data: unknown): boolean {
  for (const c of conditions) if (!evalCondition(c, data)) return false
  return true
}

export const CONDITION_OP_LABELS: Record<Condition['op'], string> = {
  eq: 'equals',
  neq: 'does not equal',
  contains: 'contains',
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
  regex: 'matches regex',
  glob: 'matches pattern (*)',
  exists: 'exists',
  notExists: 'does not exist'
}
