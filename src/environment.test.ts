import { describe, expect, it } from 'vitest'
import { parseRetoolEnvironment } from './environment.js'

describe('parseRetoolEnvironment', () => {
  it('defaults previews to staging', () => {
    expect(parseRetoolEnvironment(undefined)).toBe('staging')
    expect(parseRetoolEnvironment('')).toBe('staging')
  })

  it('accepts the two configured Retool environment names', () => {
    expect(parseRetoolEnvironment('staging')).toBe('staging')
    expect(parseRetoolEnvironment('production')).toBe('production')
  })

  it('rejects names that Retool does not have', () => {
    expect(() => parseRetoolEnvironment('preview')).toThrow(
      'invalid environment "preview"; expected staging or production',
    )
  })
})
