import { describe, expect, it } from 'vitest'
import { countLeafConditions, evalCondition, evalConditions, looseEquals } from './conditions'

describe('looseEquals', () => {
  it('compares numbers and numeric strings', () => {
    expect(looseEquals('1', 1)).toBe(true)
    expect(looseEquals(0.25, '0.25')).toBe(true)
    expect(looseEquals('2', 1)).toBe(false)
  })
  it('compares strings case-insensitively', () => {
    expect(looseEquals('Flash', 'flash')).toBe(true)
  })
  it('compares booleans and boolean strings', () => {
    expect(looseEquals(true, 'true')).toBe(true)
    expect(looseEquals(false, 'true')).toBe(false)
  })
})

describe('evalCondition', () => {
  const data = {
    alertLevel: '1',
    key: 'lights-hyperspace',
    n: 5,
    sound: { asset: '/Sounds/explosion.mp3' },
    macros: [{ stepId: 'a' }, { stepId: 'b' }],
    flag: true
  }
  it('eq / neq', () => {
    expect(evalCondition({ path: 'alertLevel', op: 'eq', value: 1 }, data)).toBe(true)
    expect(evalCondition({ path: 'alertLevel', op: 'neq', value: '1' }, data)).toBe(false)
    expect(evalCondition({ path: 'missing', op: 'neq', value: 'x' }, data)).toBe(true)
  })
  it('contains on strings and arrays', () => {
    expect(evalCondition({ path: 'sound.asset', op: 'contains', value: 'Explosion' }, data)).toBe(
      true
    )
    expect(evalCondition({ path: 'macros[].stepId', op: 'contains', value: 'b' }, data)).toBe(true)
  })
  it('numeric comparisons', () => {
    expect(evalCondition({ path: 'n', op: 'gt', value: 4 }, data)).toBe(true)
    expect(evalCondition({ path: 'n', op: 'lte', value: '4' }, data)).toBe(false)
    expect(evalCondition({ path: 'key', op: 'gt', value: 4 }, data)).toBe(false)
  })
  it('regex and glob', () => {
    expect(evalCondition({ path: 'key', op: 'regex', value: '^lights-' }, data)).toBe(true)
    expect(evalCondition({ path: 'key', op: 'glob', value: 'lights-*' }, data)).toBe(true)
    expect(evalCondition({ path: 'key', op: 'glob', value: 'sound-*' }, data)).toBe(false)
    expect(evalCondition({ path: 'key', op: 'regex', value: '[' }, data)).toBe(false)
  })
  it('exists / notExists', () => {
    expect(evalCondition({ path: 'flag', op: 'exists' }, data)).toBe(true)
    expect(evalCondition({ path: 'nope', op: 'exists' }, data)).toBe(false)
    expect(evalCondition({ path: 'nope', op: 'notExists' }, data)).toBe(true)
  })
  it('array wildcard: any element matches for positive ops', () => {
    expect(evalCondition({ path: 'macros[].stepId', op: 'eq', value: 'b' }, data)).toBe(true)
    expect(evalCondition({ path: 'macros[].stepId', op: 'eq', value: 'z' }, data)).toBe(false)
    expect(evalCondition({ path: 'macros[].stepId', op: 'neq', value: 'a' }, data)).toBe(false)
  })
  it('ANDs a list', () => {
    expect(
      evalConditions(
        [
          { path: 'n', op: 'gt', value: 1 },
          { path: 'flag', op: 'eq', value: true }
        ],
        data
      )
    ).toBe(true)
    expect(
      evalConditions(
        [
          { path: 'n', op: 'gt', value: 1 },
          { path: 'flag', op: 'eq', value: false }
        ],
        data
      )
    ).toBe(false)
  })
  it('"any of" group passes when any leaf passes', () => {
    const group = {
      any: [
        { path: 'alertLevel', op: 'eq' as const, value: '2' },
        { path: 'alertLevel', op: 'eq' as const, value: '1' }
      ]
    }
    expect(evalConditions([group], data)).toBe(true)
  })
  it('"any of" group fails when no leaf passes', () => {
    const group = {
      any: [
        { path: 'alertLevel', op: 'eq' as const, value: '2' },
        { path: 'alertLevel', op: 'eq' as const, value: '3' }
      ]
    }
    expect(evalConditions([group], data)).toBe(false)
  })
  it('mixes an AND leaf with an "any of" group — (x) and (y or z)', () => {
    const nodes = [
      { path: 'flag', op: 'eq' as const, value: true },
      {
        any: [
          { path: 'alertLevel', op: 'eq' as const, value: '9' },
          { path: 'alertLevel', op: 'eq' as const, value: '1' }
        ]
      }
    ]
    expect(evalConditions(nodes, data)).toBe(true)
    expect(evalConditions([{ path: 'flag', op: 'eq', value: false }, nodes[1]], data)).toBe(false)
  })
  it('countLeafConditions counts group contents', () => {
    expect(
      countLeafConditions([
        { path: 'a', op: 'eq', value: 1 },
        {
          any: [
            { path: 'b', op: 'eq', value: 2 },
            { path: 'c', op: 'eq', value: 3 }
          ]
        }
      ])
    ).toBe(3)
  })
})
