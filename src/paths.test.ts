import { describe, it, expect } from 'vitest'
import { TOOL_ROOT, DEFAULT_APP_DIR, MCP_URL, authDir, logsDir } from './paths.js'

describe('paths', () => {
  it('points at the tool root and target app, not the retool-ops repo root', () => {
    expect(TOOL_ROOT).toBe('/Users/arsany.milad.ext/Projects/local-mcp-runner')
    expect(DEFAULT_APP_DIR).toContain('Shift Utilization Dashboard')
    expect(MCP_URL).toBe('https://ops.wayve.retool.com/mcp')
    expect(authDir()).toBe(TOOL_ROOT + '/.mcp-auth')
    expect(logsDir()).toBe(TOOL_ROOT + '/logs')
  })
})
