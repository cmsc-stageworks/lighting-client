import { promises as fs } from 'fs'
import { join } from 'path'
import { z } from 'zod'
import { LIGHTING_MODES, localDayKey, type LightingMode } from '@shared/lightingMode'
import { getLogger } from '../logging'

const log = getLogger('config')

const ModeFileSchema = z.object({
  mode: z.enum(LIGHTING_MODES),
  since: z.number(),
  /** local calendar day the mode was set or last confirmed */
  day: z.string()
})
export type ModeState = z.infer<typeof ModeFileSchema>

/**
 * The lighting mode lives in its own small file, not config.json: it is
 * operational state (no backups, not exported) that must survive a crash or
 * restart on the same day but start each new day in Normal.
 */
export class ModeStateStore {
  private file: string
  private writing: Promise<void> = Promise.resolve()

  constructor(
    userData: string,
    private now: () => number = Date.now
  ) {
    this.file = join(userData, 'lighting-mode.json')
  }

  /** The saved mode if it was set today; otherwise Normal. */
  async load(): Promise<{ state: ModeState; restored: boolean; expired: ModeState | null }> {
    const fresh: ModeState = { mode: 'normal', since: this.now(), day: localDayKey(this.now()) }
    let raw: string
    try {
      raw = await fs.readFile(this.file, 'utf8')
    } catch {
      return { state: fresh, restored: false, expired: null }
    }
    let parsed: ModeState
    try {
      const r = ModeFileSchema.safeParse(JSON.parse(raw))
      if (!r.success) throw new Error(r.error.message)
      parsed = r.data
    } catch (err) {
      log.warn(`lighting-mode.json unreadable, starting in Normal: ${(err as Error).message}`)
      return { state: fresh, restored: false, expired: null }
    }
    if (parsed.day !== fresh.day)
      return { state: fresh, restored: false, expired: parsed.mode === 'normal' ? null : parsed }
    return { state: parsed, restored: parsed.mode !== 'normal', expired: null }
  }

  async save(state: ModeState): Promise<void> {
    const run = async (): Promise<void> => {
      const tmp = this.file + '.tmp'
      await fs.writeFile(tmp, JSON.stringify(state, null, 2), 'utf8')
      await fs.rename(tmp, this.file)
    }
    const next = this.writing.catch(() => undefined).then(run)
    this.writing = next.catch((err) => {
      log.error(`lighting mode write failed: ${(err as Error).message}`)
    })
    await next
  }

  create(mode: LightingMode): ModeState {
    return { mode, since: this.now(), day: localDayKey(this.now()) }
  }
}
