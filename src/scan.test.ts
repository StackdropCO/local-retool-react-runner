import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { scanApps } from './scan.js'
import { DEFAULT_APP_DIR } from './paths.js'

// …/retool-ops/apps-v2/Stackdrop-Hangar/Shift Utilization Dashboard → …/retool-ops
const REPO = dirname(dirname(dirname(DEFAULT_APP_DIR)))
const hasRepo = existsSync(DEFAULT_APP_DIR)

describe.skipIf(!hasRepo)('scanApps (needs retool-ops checked out next to this tool)', () => {
  it('finds the Stackdrop-Hangar apps with their endpoints and resources', () => {
    const apps = scanApps(REPO)
    const names = apps.map((a) => a.name)
    expect(names).toContain('Shift Utilization Dashboard')

    const dash = apps.find((a) => a.name === 'Shift Utilization Dashboard')!
    expect(dash.endpoints).toContain('getShiftTimeline')
    expect(dash.resources.map((r) => r.displayName)).toContain('Databricks')
    expect(dash.path).toContain('Shift Utilization Dashboard')
    expect(dash.group).toBe('Stackdrop-Hangar')
  })
})
