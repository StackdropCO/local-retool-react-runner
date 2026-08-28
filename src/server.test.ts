import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { discoverEndpoints, globalsOptions } from './server.js'

const APP = process.env.RETOOL_TEST_APP || ''

describe.skipIf(!APP || !existsSync(join(APP, 'backend')))('discoverEndpoints (set RETOOL_TEST_APP to run)', () => {
  it('finds default-export endpoints and excludes non-endpoint helpers', () => {
    const eps = discoverEndpoints(APP)
    expect(eps.length).toBeGreaterThan(0)
    // shared helper modules (no default export) must be excluded
    expect(eps).not.toContain('shared')
  })
})

describe('globalsOptions', () => {
  const normalize = (raw: unknown) => raw

  it('forwards the environment when one was chosen', () => {
    const o = globalsOptions({ writes: false, environmentName: 'staging' }, '/rpc/x', normalize)
    expect(o.environmentName).toBe('staging')
    expect(o.writes).toBe(false)
    expect(o.endpoint).toBe('/rpc/x')
  })

  it('omits the key entirely when no environment was chosen', () => {
    // Omitted, not undefined: that is what the MCP reads as "use the default", and
    // exactOptionalPropertyTypes rejects an explicit undefined.
    const o = globalsOptions({ writes: true }, '/rpc/x', normalize)
    expect('environmentName' in o).toBe(false)
    expect(o.writes).toBe(true)
  })
})
