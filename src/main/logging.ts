import log from 'electron-log/main'
import { app } from 'electron'
import { join } from 'path'

export type Logger = {
  debug: (...a: unknown[]) => void
  info: (...a: unknown[]) => void
  warn: (...a: unknown[]) => void
  error: (...a: unknown[]) => void
}

let initialized = false

export function initLogging(level: 'debug' | 'info' | 'warn' | 'error' = 'info'): void {
  if (!initialized) {
    log.initialize()
    log.transports.file.resolvePathFn = () => join(app.getPath('userData'), 'logs', 'main.log')
    log.transports.file.maxSize = 5 * 1024 * 1024
    log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {scope} {text}'
    initialized = true
  }
  log.transports.file.level = level
  log.transports.console.level = process.env.NODE_ENV === 'development' ? 'debug' : level
}

export function getLogger(scope: string): Logger {
  return log.scope(scope)
}

export function logsDirectory(): string {
  return join(app.getPath('userData'), 'logs')
}

/** Last N lines of the main log, for the diagnostics bundle. */
export async function tailLog(lines = 200): Promise<string[]> {
  const { readFile } = await import('fs/promises')
  try {
    const content = await readFile(join(logsDirectory(), 'main.log'), 'utf8')
    const all = content.split(/\r?\n/)
    return all.slice(Math.max(0, all.length - lines))
  } catch {
    return []
  }
}
