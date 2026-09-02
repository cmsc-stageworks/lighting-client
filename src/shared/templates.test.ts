import { describe, expect, it } from 'vitest'
import { renderTemplate } from './templates'

describe('renderTemplate', () => {
  const ctx = {
    name: 'changeSimulatorAlertLevel',
    simulatorName: 'Magellan',
    ts: 123,
    data: { alertLevel: '1', nested: { a: [1, 2] } }
  }
  it('interpolates simple paths', () => {
    expect(renderTemplate('{{ name }} on {{simulatorName}} @ {{ ts }}', ctx)).toBe(
      'changeSimulatorAlertLevel on Magellan @ 123'
    )
  })
  it('renders nested and json', () => {
    expect(renderTemplate('{{ data.alertLevel }}', ctx)).toBe('1')
    expect(renderTemplate('{{ json data.nested }}', ctx)).toBe('{"a":[1,2]}')
    expect(renderTemplate('{{ data.nested }}', ctx)).toBe('{"a":[1,2]}')
  })
  it('unknown paths render empty', () => {
    expect(renderTemplate('[{{ data.nope }}]', ctx)).toBe('[]')
  })
  it('leaves text without templates alone', () => {
    expect(renderTemplate('{"x":1}', ctx)).toBe('{"x":1}')
  })
})
