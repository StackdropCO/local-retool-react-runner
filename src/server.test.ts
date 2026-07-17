import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { discoverEndpoints } from './server.js'
import { DEFAULT_APP_DIR } from './paths.js'

describe.skipIf(!existsSync(DEFAULT_APP_DIR))('discoverEndpoints (needs retool-ops checked out)', () => {
  it('finds default-export endpoints and excludes shared helpers', () => {
    const eps = discoverEndpoints(DEFAULT_APP_DIR)
    expect(eps).toContain('getShiftTimeline')
    expect(eps).toContain('classifyGap')
    expect(eps).not.toContain('shared')
    expect(eps).not.toContain('shiftBands')
  })
})
