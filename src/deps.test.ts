import { describe, it, expect } from 'vitest'
import { computeMissing } from './deps.js'

describe('computeMissing', () => {
  it('returns name@version only for deps not already installed', () => {
    const deps = { react: '19.2.7', recharts: '3.8.1', clsx: '2.1.1' }
    const installed = new Set(['react', 'clsx'])
    const missing = computeMissing(deps, (n) => installed.has(n))
    expect(missing).toEqual(['recharts@3.8.1'])
  })

  it('returns empty when everything is present', () => {
    expect(computeMissing({ react: '19.2.7' }, () => true)).toEqual([])
  })
})
