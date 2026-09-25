import { describe, expect, it, vi } from 'vitest'
import { createCliSqlRunner, createLiveSqlRunner } from './liveSql.js'
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

  it('fails before returning a runner when the database environment gate does not match', async () => {
    const mcp = fakeMcp()
    vi.mocked(mcp.executeResourceTs).mockResolvedValue({ data: [{ environment: 'production' }] })

    await expect(createLiveSqlRunner({
      resources: { databricks: 'db-uuid' },
      environmentName: 'staging',
      environmentGate: {
        resource: 'databricks',
        sql: 'SELECT environment FROM environment_metadata',
        expected: { environment: 'staging' },
      },
      mcp,
    })).rejects.toThrow(/environment gate failed for "staging".*expected "staging".*"production"/)
  })

  it('returns the runner only after the database environment gate matches', async () => {
    const mcp = fakeMcp()
    vi.mocked(mcp.executeResourceTs).mockResolvedValueOnce({ data: [{ database_name: 'analytics_staging' }] })

    const live = await createLiveSqlRunner({
      resources: { databricks: 'db-uuid' },
      environmentName: 'staging',
      environmentGate: {
        resource: 'databricks',
        sql: 'SELECT current_database() AS database_name',
        expected: { database_name: 'analytics_staging' },
      },
      mcp,
    })

    expect(mcp.executeResourceTs).toHaveBeenCalledWith(
      ['db-uuid'],
      'return await databricks.query("SELECT current_database() AS database_name")',
      'staging',
    )
    await live.close()
  })
})

describe('createCliSqlRunner', () => {
  it('runs read-only SQL through the generated CLI resource binding', async () => {
    const explore = vi.fn().mockResolvedValue({ ran: true, data: { data: [{ total: 42 }] } })
    const live = await createCliSqlRunner({
      resources: { warehouse: 'databricks' },
      checkoutDir: '/cli-checkout',
      environmentName: 'staging',
      explore,
    })

    await expect(live.runSql('warehouse', 'SELECT 42 AS total')).resolves.toEqual([{ total: 42 }])
    expect(explore).toHaveBeenCalledWith('return await databricks.query("SELECT 42 AS total")', {
      checkoutDir: '/cli-checkout',
      environmentName: 'staging',
      rows: 5000,
      allowMutative: false,
    })
  })

  it('requires an explicit environment and refuses writes before invoking the CLI', async () => {
    await expect(createCliSqlRunner({
      resources: { warehouse: 'databricks' }, checkoutDir: '/cli-checkout', environmentName: '',
    })).rejects.toThrow(/explicit Retool environment/i)

    const explore = vi.fn()
    const live = await createCliSqlRunner({
      resources: { warehouse: 'databricks' },
      checkoutDir: '/cli-checkout',
      environmentName: 'staging',
      explore,
    })
    await expect(live.runSql('warehouse', 'DELETE FROM metrics')).rejects.toThrow(/read-only/i)
    expect(explore).not.toHaveBeenCalled()
  })

  it('applies the same database-backed environment gate', async () => {
    const explore = vi.fn().mockResolvedValue({
      ran: true, data: { data: [{ environment: 'production' }] },
    })
    await expect(createCliSqlRunner({
      resources: { warehouse: 'databricks' },
      checkoutDir: '/cli-checkout',
      environmentName: 'staging',
      environmentGate: {
        resource: 'warehouse',
        sql: 'SELECT environment FROM environment_metadata',
        expected: { environment: 'staging' },
      },
      explore,
    })).rejects.toThrow(/environment gate failed for "staging".*production/i)
  })
})
