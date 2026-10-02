import { describe, expect, it, vi } from 'vitest'
import { createAutoClient } from './autoClient.js'
import type { McpClient } from './mcpClient.js'

function client(label: string, resourceTypes: Record<string, string> = {}): McpClient {
  return {
    executeResourceTs: vi.fn().mockResolvedValue(label),
    batchCalls: vi.fn(async (fn) => await fn()),
    getResourceBindings: vi.fn(async (resourceNames: string[]) => resourceNames.map((resource_id) => ({
      resource_id,
      variable_name: 'resource',
      type: resourceTypes[resource_id] ?? 'postgresql',
    }))),
    listResources: vi.fn().mockResolvedValue([{ name: 'one' }]),
    listGroups: vi.fn().mockResolvedValue([{ id: 1, name: label }]),
    close: vi.fn().mockResolvedValue(undefined),
  }
}

describe('createAutoClient', () => {
  it('routes any positively classified read to MCP', async () => {
    const cli = client('cli')
    const mcp = client('mcp')
    const auto = createAutoClient(cli, mcp)

    await expect(auto.executeResourceTs(
      ['resource-id'],
      'return await resource.anyOperation()',
      'staging',
      { safeRead: true },
    )).resolves.toBe('mcp')

    expect(mcp.executeResourceTs).toHaveBeenCalledOnce()
    expect(cli.executeResourceTs).not.toHaveBeenCalled()
  })

  it('keeps a safe base-URL REST read on CLI because MCP cannot execute that binding', async () => {
    const cli = client('cli', { 'fleet-id': 'restapi' })
    const mcp = client('mcp')
    const auto = createAutoClient(cli, mcp)

    await expect(auto.executeResourceTs(
      ['fleet-id'],
      'return await fleet360.rawRequest({"method":"GET","path":"vehicle/status-history"})',
      'staging',
      { allowMutative: true, safeRead: true },
    )).resolves.toBe('cli')

    expect(cli.executeResourceTs).toHaveBeenCalledOnce()
    expect(mcp.executeResourceTs).not.toHaveBeenCalled()
  })

  it('requires every resource in a safe call to be MCP-capable', async () => {
    const cli = client('cli', { database: 'databricks', fleet: 'restapi' })
    const mcp = client('mcp')
    const auto = createAutoClient(cli, mcp)

    await expect(auto.executeResourceTs(
      ['database', 'fleet'],
      'return await combinedRead()',
      'staging',
      { safeRead: true },
    )).resolves.toBe('cli')

    expect(mcp.executeResourceTs).not.toHaveBeenCalled()
  })

  it.each([
    ['an unclassified operation', undefined],
    ['an explicitly unsafe operation', { safeRead: false }],
    ['a mutative operation', { allowMutative: true }],
  ])('keeps %s on the CLI', async (_label, options) => {
    const cli = client('cli')
    const mcp = client('mcp')
    const auto = createAutoClient(cli, mcp)

    await expect(auto.executeResourceTs(
      ['resource-id'],
      'return await resource.anyOperation()',
      'production',
      options,
    )).resolves.toBe('cli')

    expect(cli.executeResourceTs).toHaveBeenCalledOnce()
    expect(mcp.executeResourceTs).not.toHaveBeenCalled()
  })

  it('retains CLI batching while safe reads use MCP inside the same request', async () => {
    const cli = client('cli')
    const mcp = client('mcp')
    const auto = createAutoClient(cli, mcp)

    const result = await auto.batchCalls!(() => Promise.all([
      auto.executeResourceTs(['read'], 'return read()', 'staging', { safeRead: true }),
      auto.executeResourceTs(['unknown'], 'return unknown()', 'staging'),
    ]))

    expect(result).toEqual(['mcp', 'cli'])
    expect(cli.batchCalls).toHaveBeenCalledOnce()
  })

  it('uses the CLI sidecar for definitions and MCP for group discovery', async () => {
    const cli = client('cli')
    const mcp = client('mcp')
    const auto = createAutoClient(cli, mcp)

    await auto.getResourceBindings(['one'])
    await auto.listResources()
    await expect(auto.listGroups()).resolves.toEqual([{ id: 1, name: 'mcp' }])

    expect(cli.getResourceBindings).toHaveBeenCalledOnce()
    expect(cli.listResources).toHaveBeenCalledOnce()
    expect(mcp.listGroups).toHaveBeenCalledOnce()
  })
})
