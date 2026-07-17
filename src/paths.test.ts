import { describe, it, expect } from 'vitest'
import { TOOL_ROOT, authDir, logsDir } from './paths.js'

describe('paths', () => {
  it('derives the tool root and namespaced dirs (portable, no hardcoded home)', () => {
    expect(TOOL_ROOT.endsWith('/local-mcp-runner')).toBe(true)
    expect(authDir()).toBe(TOOL_ROOT + '/.mcp-auth')
    expect(authDir('example.com')).toBe(TOOL_ROOT + '/.mcp-auth/example.com')
    expect(logsDir()).toBe(TOOL_ROOT + '/logs')
  })
})
