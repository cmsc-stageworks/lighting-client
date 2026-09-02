import { existsSync, readFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { buildSchema, parse, validate } from 'graphql'
import { describe, expect, it } from 'vitest'
import * as operations from './operations'

/**
 * Every GraphQL document we send is validated against Thorium's own schema.
 *
 * This exists because a query that names a field Thorium does not have (`thorium { version }`)
 * is rejected by Apollo with a blanket 400 for the WHOLE request, which looked like a
 * connection failure rather than a bad query. Unit tests with a stubbed `fetch` cannot catch
 * that, because the stub answers whatever it is asked.
 *
 * The schema is read from the sibling Thorium checkout; the test is skipped when it is absent
 * so this repo still tests standalone.
 */
const here = dirname(fileURLToPath(import.meta.url))
const schemaPath = resolve(here, '../../../../../thorium/src/schema.graphql')
const candidates = [schemaPath, join(process.cwd(), '../thorium/src/schema.graphql')]
const found = candidates.find((p) => existsSync(p))

describe.skipIf(!found)('GraphQL operations match the Thorium schema', () => {
  const schema = buildSchema(readFileSync(found!, 'utf8'))
  const docs = Object.entries(operations).filter(
    ([, v]) => typeof v === 'string' && /^\s*(query|mutation|subscription)\b/.test(v)
  ) as [string, string][]

  it('finds the operation constants', () => {
    expect(docs.length).toBeGreaterThan(15)
  })

  it.each(docs)('%s is valid', (_name, doc) => {
    const errors = validate(schema, parse(doc))
    expect(errors.map((e) => e.message)).toEqual([])
  })
})
