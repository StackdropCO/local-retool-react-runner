import { describe, expect, it } from 'vitest'
import { DEFAULT_CURRENT_USER, parseCurrentUser, resolveCurrentUser } from './currentUser.js'

describe('current user emulation', () => {
  it('uses a complete safe default', () => {
    expect(resolveCurrentUser(undefined)).toEqual(DEFAULT_CURRENT_USER)
  })

  it('validates the identity fields supplied by the panel', () => {
    expect(() => parseCurrentUser({ id: '1', email: 'dev@example.com', groups: [] })).toThrow(/id/)
    expect(() => parseCurrentUser({ id: 1, email: '', groups: [] })).toThrow(/email/)
    expect(() => parseCurrentUser({ id: 1, email: 'dev@example.com', groups: [{}] })).toThrow(/groups/)
  })
})
