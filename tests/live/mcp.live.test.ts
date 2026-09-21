import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createLiveSqlRunner, type LiveSqlRunner } from 'local-mcp-runner/live-sql'

const resourceId = process.env.LIVE_SQL_RESOURCE_ID
if (!resourceId) {
  throw new Error('LIVE_SQL_RESOURCE_ID is required (the Retool resource UUID to query)')
}

let live: LiveSqlRunner

describe('real SQL through MCP', () => {
  beforeAll(async () => {
    live = await createLiveSqlRunner({
      resources: { databricks: resourceId },
      environmentName: process.env.LIVE_SQL_ENVIRONMENT,
    })
  })

  afterAll(async () => {
    await live?.close()
  })

  it('executes SQL against the configured real resource', async () => {
    const rows = await live.runSql<{ ok: number | string }>('databricks', 'SELECT 1 AS ok')

    expect(rows).toHaveLength(1)
    expect(Number(rows[0].ok)).toBe(1)
  })
})
