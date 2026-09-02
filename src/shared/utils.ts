/** Small, dependency-free helpers shared by main and renderer. */

export function uuid(): string {
  const c = globalThis.crypto as Crypto | undefined
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  // Fallback (should not happen in Electron)
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0
    const v = ch === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

export function shortId(len = 4): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789'
  let out = ''
  for (let i = 0; i < len; i++) out += alphabet[(Math.random() * alphabet.length) | 0]
  return out
}

export function clamp(n: number, min: number, max: number): number {
  return n < min ? min : n > max ? max : n
}

export function eqIgnoreCase(a: string | null | undefined, b: string | null | undefined): boolean {
  if (a == null || b == null) return false
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

/**
 * Glob matcher supporting `*` (any run of characters) and `?` (one character).
 * Used for generic keys, MQTT topics in conditions, and trigger params.
 */
export function globToRegExp(glob: string, flags = 'i'): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')
  return new RegExp(`^${escaped}$`, flags)
}

/** MQTT topic filter match (`+` single level, `#` multi level). */
export function mqttTopicMatches(filter: string, topic: string): boolean {
  const f = filter.split('/')
  const t = topic.split('/')
  for (let i = 0; i < f.length; i++) {
    const seg = f[i]
    if (seg === '#') return true
    if (i >= t.length) return false
    if (seg !== '+' && seg !== t[i]) return false
  }
  return f.length === t.length
}

/** Resolve a dot/bracket path against an object. `[]` means "any element" and returns an array. */
export function resolvePath(obj: unknown, path: string): { found: boolean; value: unknown } {
  if (!path) return { found: true, value: obj }
  const tokens = tokenizePath(path)
  return walk(obj, tokens, 0)
}

function walk(cur: unknown, tokens: PathToken[], i: number): { found: boolean; value: unknown } {
  if (i >= tokens.length) return { found: true, value: cur }
  const tok = tokens[i]
  if (cur == null) return { found: false, value: undefined }
  if (tok.kind === 'any') {
    if (!Array.isArray(cur)) return { found: false, value: undefined }
    const results: unknown[] = []
    let any = false
    for (const el of cur) {
      const r = walk(el, tokens, i + 1)
      if (r.found) {
        any = true
        results.push(r.value)
      }
    }
    return { found: any, value: results }
  }
  if (typeof cur !== 'object') return { found: false, value: undefined }
  const rec = cur as Record<string, unknown>
  if (!(tok.key in rec)) return { found: false, value: undefined }
  return walk(rec[tok.key], tokens, i + 1)
}

type PathToken = { kind: 'key'; key: string } | { kind: 'any' }

function tokenizePath(path: string): PathToken[] {
  const out: PathToken[] = []
  const re = /([^.[\]]+)|\[(\d*)\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(path))) {
    if (m[1] !== undefined) out.push({ kind: 'key', key: m[1] })
    else if (m[2] === '') out.push({ kind: 'any' })
    else out.push({ kind: 'key', key: m[2] })
  }
  return out
}

export function formatAgo(ts: number | null | undefined, now = Date.now()): string {
  if (!ts) return 'never'
  const s = Math.max(0, Math.round((now - ts) / 1000))
  if (s < 5) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 48) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

export function hashString(input: string): string {
  // FNV-1a 32-bit, good enough for "did settings change" comparisons.
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16)
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}
function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys)
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return Object.keys(o)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = sortKeys(o[k])
        return acc
      }, {})
  }
  return v
}

export function debounce<T extends (...a: never[]) => void>(fn: T, ms: number): T {
  let t: ReturnType<typeof setTimeout> | null = null
  return ((...args: Parameters<T>) => {
    if (t) clearTimeout(t)
    t = setTimeout(() => fn(...args), ms)
  }) as T
}
