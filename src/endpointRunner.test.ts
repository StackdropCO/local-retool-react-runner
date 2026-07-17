import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createRunner, readResourceRefs } from './endpointRunner.js'

const here = dirname(fileURLToPath(import.meta.url))
const APP = process.env.RETOOL_TEST_APP || ''

describe.skipIf(!APP || !existsSync(join(APP, 'package.json')))('readResourceRefs (set RETOOL_TEST_APP to run)', () => {
  it('flattens the app package.json resourceReferencesByFile to unique refs', () => {
    const refs = readResourceRefs(APP)
    expect(refs.length).toBeGreaterThan(0)
    // each ref has name (Resource id), displayName, type; no duplicate displayNames
    const displayNames = refs.map((r) => r.displayName)
    expect(new Set(displayNames).size).toBe(displayNames.length)
    for (const r of refs) {
      expect(typeof r.name).toBe('string')
      expect(typeof r.type).toBe('string')
    }
  })
})

describe('createRunner', () => {
  it('injects globals and runs a backend endpoint by file name', async () => {
    ;(globalThis as any).fakeResource = { query: async () => ({ data: [{ ok: 1 }] }) }
    const runner = createRunner({ appDir: join(here, 'fixtures'), globals: {}, user: { email: 'dev@local' } })
    const out: any = await runner.run('echoEndpoint', { a: 1 })
    expect(out.params).toEqual({ a: 1 })
    expect(out.user).toEqual({ email: 'dev@local' })
    expect(out.probe).toEqual({ data: [{ ok: 1 }] })
  })
})
