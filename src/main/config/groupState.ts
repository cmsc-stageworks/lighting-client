import { promises as fs } from 'fs'
import { join } from 'path'
import { z } from 'zod'
import { getLogger } from '../logging'

const log = getLogger('config')

const GroupFileSchema = z.object({
  /** Keyed by profile id: switching profile and back keeps each one's choice. */
  byProfile: z.record(z.string(), z.object({ groupId: z.string(), since: z.number() }))
})
type GroupFile = z.infer<typeof GroupFileSchema>

/**
 * The active mapping group lives in its own small file, like the lighting mode:
 * it is operational state staff flip during the day, not configuration (no
 * backups, not exported). Unlike the mode it has no daily reset — a room keeps
 * its chosen look until someone changes it.
 */
export class GroupStateStore {
  private file: string
  private state: GroupFile = { byProfile: {} }
  private writing: Promise<void> = Promise.resolve()

  constructor(
    userData: string,
    private now: () => number = Date.now
  ) {
    this.file = join(userData, 'mapping-group.json')
  }

  async load(): Promise<void> {
    let raw: string
    try {
      raw = await fs.readFile(this.file, 'utf8')
    } catch {
      return
    }
    try {
      const r = GroupFileSchema.safeParse(JSON.parse(raw))
      if (!r.success) throw new Error(r.error.message)
      this.state = r.data
    } catch (err) {
      log.warn(
        `mapping-group.json unreadable, starting in the first group: ${(err as Error).message}`
      )
    }
  }

  /** The saved group for a profile, or null. The caller checks it still exists. */
  get(profileId: string): string | null {
    return this.state.byProfile[profileId]?.groupId ?? null
  }

  async set(profileId: string, groupId: string): Promise<void> {
    this.state = {
      byProfile: { ...this.state.byProfile, [profileId]: { groupId, since: this.now() } }
    }
    const snapshot = JSON.stringify(this.state, null, 2)
    const run = async (): Promise<void> => {
      const tmp = this.file + '.tmp'
      await fs.writeFile(tmp, snapshot, 'utf8')
      await fs.rename(tmp, this.file)
    }
    const next = this.writing.catch(() => undefined).then(run)
    this.writing = next.catch((err) => {
      log.error(`mapping group write failed: ${(err as Error).message}`)
    })
    await next
  }
}
