import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { scanApps } from './scan.js'

// Set RETOOL_TEST_APP to an apps-v2 app dir to exercise scan against real data.
const APP = process.env.RETOOL_TEST_APP || ''
const REPO = APP ? dirname(dirname(dirname(APP))) : ''

describe.skipIf(!APP || !existsSync(APP))('scanApps (set RETOOL_TEST_APP to run)', () => {
  it('finds apps under a repo with their endpoints and resources', () => {
    const apps = scanApps(REPO)
    expect(apps.length).toBeGreaterThan(0)
    const target = apps.find((a) => APP.endsWith(a.path.split('/').slice(-1)[0]))!
    expect(target).toBeTruthy()
    expect(target.endpoints.length).toBeGreaterThan(0)
    expect(target.resources.length).toBeGreaterThan(0)
  })
})
