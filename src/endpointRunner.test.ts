import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createRunner, readResourceRefs } from './endpointRunner.js'
import { DEFAULT_APP_DIR } from './paths.js'

const here = dirname(fileURLToPath(import.meta.url))

describe.skipIf(!existsSync(DEFAULT_APP_DIR))('readResourceRefs (needs retool-ops checked out)', () => {
  it('flattens the app package.json resourceReferencesByFile to unique name/display/type', () => {
    const refs = readResourceRefs(DEFAULT_APP_DIR)
    const names = refs.map((r) => r.displayName).sort()
    expect(names).toContain('Databricks')
    expect(names).toContain('Lakebase Retool - OLTP')
    expect(names).toContain('ConnectTeamAPI')
    const lake = refs.filter((r) => r.displayName === 'Lakebase Retool - OLTP')
    expect(lake).toHaveLength(1) // de-duped
    expect(lake[0].name).toBe('089dd8fc-ec8d-4e34-8021-ef69d5ef7338') // Resource.name = UUID
    expect(lake[0].type).toBe('databricksLakebase')
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
