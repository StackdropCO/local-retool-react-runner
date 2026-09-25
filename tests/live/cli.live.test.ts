import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createCliSqlRunner, type LiveSqlRunner } from 'local-mcp-runner/live-sql'

const resourceBinding = process.env.LIVE_SQL_RESOURCE_BINDING
const checkoutDir = process.env.RETOOL_CLI_CHECKOUT
if (!resourceBinding || !checkoutDir) {
  throw new Error('LIVE_SQL_RESOURCE_BINDING and RETOOL_CLI_CHECKOUT are required')
}

let live: LiveSqlRunner

describe('real SQL through Retool CLI', () => {
  beforeAll(async () => {
    live = await createCliSqlRunner({
      resources: { databricks: resourceBinding },
      checkoutDir,
      environmentName: process.env.LIVE_SQL_ENVIRONMENT ?? 'staging',
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
