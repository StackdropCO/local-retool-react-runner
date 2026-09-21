import { describe, expect, it, vi } from 'vitest'
import { createLiveSqlRunner } from './liveSql.js'
import type { McpClient } from './mcpClient.js'

function fakeMcp(): McpClient {
  return {
    executeResourceTs: vi.fn().mockResolvedValue({ data: [{ total: 42 }] }),
    getResourceBindings: vi.fn().mockResolvedValue([
      { resource_id: 'db-uuid', variable_name: 'databricks', type: 'databricks' },
    ]),
    listResources: vi.fn(),
    close: vi.fn(),
  } as unknown as McpClient
}

describe('createLiveSqlRunner', () => {
  it('resolves a resource once and returns rows for normal Vitest assertions', async () => {
    const mcp = fakeMcp()
    const live = await createLiveSqlRunner({ resources: { databricks: 'db-uuid' }, mcp })

    await expect(live.runSql<{ total: number }>('databricks', 'SELECT 42 AS total')).resolves.toEqual([{ total: 42 }])
    await live.runSql('databricks', 'SELECT * FROM metrics WHERE day = ?', ['2026-09-21'])

    expect(mcp.getResourceBindings).toHaveBeenCalledTimes(1)
    expect(mcp.executeResourceTs).toHaveBeenNthCalledWith(
      1,
      ['db-uuid'],
      'return await databricks.query("SELECT 42 AS total")',
      undefined,
    )
    expect(mcp.executeResourceTs).toHaveBeenNthCalledWith(
      2,
      ['db-uuid'],
      'return await databricks.query("SELECT * FROM metrics WHERE day = ?", ["2026-09-21"])',
      undefined,
    )
  })

  it('refuses writes before they reach MCP', async () => {
    const mcp = fakeMcp()
    const live = await createLiveSqlRunner({ resources: { databricks: 'db-uuid' }, mcp })

    await expect(live.runSql('databricks', 'DELETE FROM metrics')).rejects.toThrow(/read-only/)
    expect(mcp.executeResourceTs).not.toHaveBeenCalled()
  })

  it('fails when the configured UUID has no MCP binding', async () => {
    const mcp = fakeMcp()
    vi.mocked(mcp.getResourceBindings).mockResolvedValue([])

    await expect(createLiveSqlRunner({ resources: { databricks: 'missing' }, mcp }))
      .rejects.toThrow(/did not return a binding/)
  })
})
