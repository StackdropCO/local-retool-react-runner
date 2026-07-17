import { describe, it, expect } from 'vitest'
import { scanApps } from './scan.js'

const REPO = '/Users/arsany.milad.ext/Projects/retool-ops'

describe('scanApps', () => {
  it('finds the Stackdrop-Hangar apps with their endpoints and resources', () => {
    const apps = scanApps(REPO)
    const names = apps.map((a) => a.name)
    expect(names).toContain('Shift Utilization Dashboard')
    expect(names).toContain('Shift Utilisation Clock')

    const dash = apps.find((a) => a.name === 'Shift Utilization Dashboard')!
    expect(dash.endpoints).toContain('getShiftTimeline')
    expect(dash.resources.map((r) => r.displayName)).toContain('Databricks')
    expect(dash.path).toContain('Shift Utilization Dashboard')
    expect(dash.group).toBe('Stackdrop-Hangar')
  })
})
