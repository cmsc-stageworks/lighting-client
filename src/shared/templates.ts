import { resolvePath } from './utils'

/**
 * Tiny mustache-like interpolation used for MQTT publish payloads.
 *
 *   {{ data.alertLevel }}      → value at path (objects are JSON-encoded)
 *   {{ json data }}            → JSON.stringify of the path
 *   {{ simulatorName }}        → top-level event field
 *   {{ ts }}                   → event timestamp
 *
 * Unknown paths render as an empty string.
 */
export function renderTemplate(template: string, context: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_m, expr: string) => {
    const parts = expr.trim().split(/\s+/)
    let path = parts[0]
    let mode: 'text' | 'json' = 'text'
    if (parts.length === 2 && parts[0] === 'json') {
      mode = 'json'
      path = parts[1]
    }
    const { found, value } = resolvePath(context, path)
    if (!found || value === undefined) return ''
    if (mode === 'json') return JSON.stringify(value)
    if (value === null) return ''
    if (typeof value === 'object') return JSON.stringify(value)
    return String(value)
  })
}
