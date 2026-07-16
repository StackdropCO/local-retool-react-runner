import { describe, it, expect } from 'vitest'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createRunner, readResourceRefs } from './endpointRunner.js'

const here = dirname(fileURLToPath(import.meta.url))

describe('readResourceRefs', () => {
  it('flattens the app package.json resourceReferencesByFile to unique name/display/type', () => {
    const refs = readResourceRefs('/Users/arsany.milad.ext/Projects/retool-ops/apps-v2/Stackdrop-Hangar/Shift Utilization Dashboard')
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
