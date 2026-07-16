import { describe, it, expect } from 'vitest'
import { hookModuleSource } from './vitePlugin.js'

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
