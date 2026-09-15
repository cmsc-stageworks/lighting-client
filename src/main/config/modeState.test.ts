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

import { ModeStateStore } from './modeState'

describe('ModeStateStore', () => {
  let dir: string
  let now: number
  const day1 = new Date(2026, 8, 12, 14, 0).getTime()
  const day1Later = new Date(2026, 8, 12, 23, 30).getTime()
  const day2 = new Date(2026, 8, 13, 8, 0).getTime()

  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'lm-'))
    now = day1
  })
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  const store = (): ModeStateStore => new ModeStateStore(dir, () => now)

  it('starts in Normal when there is no file', async () => {
    const r = await store().load()
    expect(r.state.mode).toBe('normal')
    expect(r.restored).toBe(false)
  })

  it('restores a restrictive mode set earlier the same day', async () => {
    const s = store()
    await s.save(s.create('reduced'))
    now = day1Later
    const r = await store().load()
    expect(r.state.mode).toBe('reduced')
    expect(r.state.since).toBe(day1)
    expect(r.restored).toBe(true)
  })

  it('starts a new day in Normal and reports what expired', async () => {
    const s = store()
    await s.save(s.create('locked'))
    now = day2
    const r = await store().load()
    expect(r.state.mode).toBe('normal')
    expect(r.restored).toBe(false)
    expect(r.expired?.mode).toBe('locked')
  })

  it('falls back to Normal on a corrupt file', async () => {
    await fs.writeFile(join(dir, 'lighting-mode.json'), '{nope', 'utf8')
    expect((await store().load()).state.mode).toBe('normal')
    await fs.writeFile(join(dir, 'lighting-mode.json'), '{"mode":"party"}', 'utf8')
    expect((await store().load()).state.mode).toBe('normal')
  })
})
