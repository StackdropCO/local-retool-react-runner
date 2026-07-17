import { describe, it, expect } from 'vitest'
import { TOOL_ROOT, DEFAULT_APP_DIR, MCP_URL, authDir, logsDir } from './paths.js'

describe('paths', () => {
  it('derives the tool root and a target app path (portable, no hardcoded home)', () => {
    expect(TOOL_ROOT.endsWith('/local-mcp-runner')).toBe(true)
    expect(DEFAULT_APP_DIR).toContain('Shift Utilization Dashboard')
    expect(MCP_URL).toContain('/mcp')
    expect(authDir()).toBe(TOOL_ROOT + '/.mcp-auth')
    expect(authDir('example.com')).toBe(TOOL_ROOT + '/.mcp-auth/example.com')
    expect(logsDir()).toBe(TOOL_ROOT + '/logs')
  })
})
