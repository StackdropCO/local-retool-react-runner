import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { discoverEndpoints } from './server.js'

const APP = process.env.RETOOL_TEST_APP || ''

describe.skipIf(!APP || !existsSync(join(APP, 'backend')))('discoverEndpoints (set RETOOL_TEST_APP to run)', () => {
  it('finds default-export endpoints and excludes non-endpoint helpers', () => {
    const eps = discoverEndpoints(APP)
    expect(eps.length).toBeGreaterThan(0)
    // shared helper modules (no default export) must be excluded
    expect(eps).not.toContain('shared')
  })
})
