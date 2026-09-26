import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

vi.mock('../logging', () => ({
  getLogger: () => ({
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined
  })
}))

import { GroupStateStore } from './groupState'

describe('GroupStateStore', () => {
  let dir: string

  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'mg-'))
  })
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('has no saved group when there is no file', async () => {
    const s = new GroupStateStore(dir)
    await s.load()
    expect(s.get('p1')).toBeNull()
  })

  it('keeps the choice per profile across restarts, with no daily reset', async () => {
    let now = new Date(2026, 8, 12, 14, 0).getTime()
    const a = new GroupStateStore(dir, () => now)
    await a.set('p1', 'g2')
    await a.set('p2', 'g9')
    now = new Date(2026, 8, 20, 8, 0).getTime()
    const b = new GroupStateStore(dir, () => now)
    await b.load()
    expect(b.get('p1')).toBe('g2')
    expect(b.get('p2')).toBe('g9')
  })

  it('ignores an unreadable file', async () => {
    await fs.writeFile(join(dir, 'mapping-group.json'), '{nope', 'utf8')
    const s = new GroupStateStore(dir)
    await s.load()
    expect(s.get('p1')).toBeNull()
  })
})
