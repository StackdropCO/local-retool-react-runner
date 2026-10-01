import { describe, it, expect } from 'vitest'
import { currentUserHookModuleSource, hookModuleSource, hooksVirtualPlugin } from './vitePlugin.js'

describe('hookModuleSource', () => {
  it('emits a use-hook per endpoint with the trigger/result contract', () => {
    const src = hookModuleSource(['getShiftTimeline', 'classifyGap'], '/rpc')
    expect(src).toContain('export function useGetShiftTimeline()')
    expect(src).toContain('export function useClassifyGap()')
    expect(src).toContain('trigger:')
    expect(src).toContain('result:')
    expect(src).toContain("'/rpc/getShiftTimeline'")
  })
})

describe('currentUserHookModuleSource', () => {
  it('loads the locally emulated Retool identity', () => {
    const src = currentUserHookModuleSource()
    expect(src).toContain('export function useCurrentUser()')
    expect(src).toContain("fetch('/api/current-user')")
    expect(src).toContain('user: body.user')
  })

  it('intercepts the generated relative import used by Retool apps', async () => {
    const plugin = hooksVirtualPlugin({ appDir: '/app', endpoints: [] })
    const resolveId = plugin.resolveId as (id: string) => string | null
    const load = plugin.load as (id: string) => string | null

    const resolved = resolveId('./hooks/useCurrentUser')
    expect(resolved).toBe('\0virtual:local-mcp-runner-current-user')
    expect(load(resolved!)).toContain('export function useCurrentUser()')
  })
})

describe('hooksVirtualPlugin', () => {
  it('runs before filesystem resolution and intercepts absolute generated hook paths', () => {
    const plugin = hooksVirtualPlugin({ appDir: '/app', endpoints: ['getShiftOptions'] })
    const resolveId = plugin.resolveId as (id: string) => string | null

    expect(plugin.enforce).toBe('pre')
    expect(resolveId('/checkout/frontend/hooks/backend/shift.ts'))
      .toBe('\0virtual:local-mcp-runner-hooks')
    expect(resolveId('/checkout/frontend/hooks/useCurrentUser.ts'))
      .toBe('\0virtual:local-mcp-runner-current-user')
  })
})
