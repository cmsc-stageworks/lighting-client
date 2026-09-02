import { describe, expect, it } from 'vitest'
import { globToRegExp, mqttTopicMatches, resolvePath, stableStringify } from './utils'

describe('utils', () => {
  it('resolvePath handles dots, indexes and wildcards', () => {
    const o = { a: { b: [{ c: 1 }, { c: 2 }] } }
    expect(resolvePath(o, 'a.b[0].c')).toEqual({ found: true, value: 1 })
    expect(resolvePath(o, 'a.b[].c')).toEqual({ found: true, value: [1, 2] })
    expect(resolvePath(o, 'a.x').found).toBe(false)
    expect(resolvePath(o, '')).toEqual({ found: true, value: o })
  })
  it('glob', () => {
    expect(globToRegExp('lights-*').test('lights-abc')).toBe(true)
    expect(globToRegExp('a?c').test('abc')).toBe(true)
    expect(globToRegExp('a.c').test('abc')).toBe(false)
  })
  it('mqtt topic matching', () => {
    expect(mqttTopicMatches('a/+/c', 'a/b/c')).toBe(true)
    expect(mqttTopicMatches('a/#', 'a/b/c/d')).toBe(true)
    expect(mqttTopicMatches('a/+', 'a/b/c')).toBe(false)
    expect(mqttTopicMatches('a/b', 'a/b')).toBe(true)
  })
  it('stableStringify sorts keys', () => {
    expect(stableStringify({ b: 1, a: { d: 1, c: 2 } })).toBe('{"a":{"c":2,"d":1},"b":1}')
  })
})
