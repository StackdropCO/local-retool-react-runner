import { describe, it, expect } from 'vitest'
import { discoverEndpoints } from './server.js'

describe('discoverEndpoints', () => {
  it('finds default-export endpoints and excludes shared helpers', () => {
    const eps = discoverEndpoints('/Users/arsany.milad.ext/Projects/retool-ops/apps-v2/Stackdrop-Hangar/Shift Utilization Dashboard')
    expect(eps).toContain('getShiftTimeline')
    expect(eps).toContain('classifyGap')
    expect(eps).not.toContain('shared')
    expect(eps).not.toContain('shiftBands')
  })
})
