import { describe, expect, it } from 'vitest'
import { SimulatorRegistry, type ThoriumFlight } from './simulators'

const sim = (id: string, name: string, flightId: string): ThoriumFlight['simulators'][number] => ({
  id,
  name,
  alertLevel: '5',
  training: false,
  flightId
})
const training: ThoriumFlight = {
  id: 'f-old',
  name: 'Training',
  running: true,
  date: '2026-09-01T10:00:00Z',
  simulators: [sim('mag-old', 'Magellan', 'f-old'), sim('cas-old', 'Cassini', 'f-old')]
}
const fresh: ThoriumFlight = {
  id: 'f-new',
  name: 'Clean slate',
  running: true,
  date: '2026-09-01T11:00:00Z',
  simulators: [sim('mag-new', 'Magellan', 'f-new')]
}
const other: ThoriumFlight = {
  id: 'f-ody',
  name: 'Odyssey room',
  running: true,
  date: '2026-09-01T09:00:00Z',
  simulators: [sim('ody', 'Odyssey', 'f-ody')]
}

function reg(): SimulatorRegistry {
  const r = new SimulatorRegistry()
  r.setProfiles(
    [{ id: 'p1', name: 'Magellan', universe: 10, baseAddress: 1, color: '#fff', confirmed: true }],
    'central'
  )
  r.setFlights([training, fresh, other])
  return r
}

describe('SimulatorRegistry scoping across concurrent flights', () => {
  it('assignment modes are empty until the FD assigns a flight', () => {
    const r = reg()
    r.setScope({ mode: 'assigned-flight' })
    expect(r.requiresAssignment()).toBe(true)
    expect(r.isAssigned()).toBe(false)
    expect(r.inScope()).toEqual([])
    expect(r.isFlightInScope('f-new')).toBe(false)
    expect(r.isFlightInScope(undefined)).toBe(false)
    expect(r.warnings()[0]).toMatch(/Not assigned/)
  })
  it('assigned-flight follows every simulator of the assigned flight only', () => {
    const r = reg()
    r.setScope({ mode: 'assigned-flight' })
    r.setAssignment({ flightId: 'f-old', flightName: 'Training' })
    expect(
      r
        .inScope()
        .map((s) => s.id)
        .sort()
    ).toEqual(['cas-old', 'mag-old'])
    expect(r.isInScope('mag-new')).toBe(false)
    expect(r.isFlightInScope('f-old')).toBe(true)
    expect(r.isFlightInScope('f-new')).toBe(false)
    // FD moves the client to the clean-slate flight
    r.setAssignment({ flightId: 'f-new', flightName: 'Clean slate' })
    expect(r.inScope().map((s) => s.id)).toEqual(['mag-new'])
    expect(r.thoriumSimulatorByName('Magellan')?.id).toBe('mag-new')
  })
  it('follow-assignment narrows to the assigned simulator, or the whole flight until one is picked', () => {
    const r = reg()
    r.setScope({ mode: 'follow-assignment' })
    r.setAssignment({ flightId: 'f-old' })
    expect(
      r
        .inScope()
        .map((s) => s.id)
        .sort()
    ).toEqual(['cas-old', 'mag-old'])
    r.setAssignment({ flightId: 'f-old', simulatorId: 'cas-old' })
    expect(r.inScope().map((s) => s.id)).toEqual(['cas-old'])
    // simulator id from a different flight than the assigned one is ignored
    r.setAssignment({ flightId: 'f-new', simulatorId: 'cas-old' })
    expect(r.inScope().map((s) => s.id)).toEqual(['mag-new'])
  })
  it('an assignment to a flight that no longer exists counts as unassigned', () => {
    const r = reg()
    r.setScope({ mode: 'assigned-flight' })
    r.setAssignment({ flightId: 'gone' })
    expect(r.isAssigned()).toBe(false)
    expect(r.inScope()).toEqual([])
  })
  it('name-based modes prefer the newest flight for duplicate names and warn', () => {
    const r = reg()
    r.setScope({ mode: 'all' })
    const ids = r
      .inScope()
      .map((s) => s.id)
      .sort()
    expect(ids).toEqual(['cas-old', 'mag-new', 'ody'])
    expect(r.warnings().some((w) => /share simulator names/.test(w))).toBe(true)
    r.setScope({ mode: 'pinned', simulatorNames: ['magellan'] })
    expect(r.inScope().map((s) => s.id)).toEqual(['mag-new'])
    // once assigned, name modes are confined to that flight
    r.setAssignment({ flightId: 'f-old' })
    expect(r.inScope().map((s) => s.id)).toEqual(['mag-old'])
    expect(r.isFlightInScope('f-ody')).toBe(false)
  })
  it('flight-level events pass in name modes when unassigned', () => {
    const r = reg()
    r.setScope({ mode: 'all' })
    expect(r.isFlightInScope(undefined)).toBe(true)
    expect(r.isFlightInScope('f-ody')).toBe(true)
  })
})
