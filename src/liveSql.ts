import { connectMcp, hasCachedAuth, type McpClient, type ResourceBinding } from './mcpClient.js'
import { MCP_URL } from './paths.js'
import { buildSqlSnippet, isWrite } from './snippets.js'
import { readConfig } from './config.js'

export type SqlRow = Record<string, unknown>

export type LiveSqlRunner = {
  runSql<T extends SqlRow = SqlRow>(resource: string, sql: string, params?: unknown[]): Promise<T[]>
  close(): Promise<void>
}

export type LiveSqlRunnerOptions = {
  /** Stable test-facing alias to Retool resource UUID, for example { databricks: "..." }. */
  resources: Record<string, string>
  environmentName?: string
  mcpUrl?: string
  /** Tests normally require the existing one-time OAuth cache instead of opening a browser. */
  requireCachedAuth?: boolean
  /** Dependency injection for runner tests and advanced callers. */
  mcp?: McpClient
  /**
   * Optional fail-fast proof that MCP reached the intended database. Prefer a
   * dedicated metadata row; current_database() is a useful fallback.
   */
  environmentGate?: {
    resource: string
    sql: string
    expected: Record<string, string | number | boolean | null>
  }
}

function rowsFromResult<T extends SqlRow>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[]
  if (result && typeof result === 'object' && Array.isArray((result as { data?: unknown }).data)) {
    return (result as { data: T[] }).data
  }
  throw new Error('Live SQL resource returned neither an array nor a { data: [...] } result')
}

/**
 * Create a read-only SQL executor for opt-in live tests.
 *
 * The MCP is only the transport: this returns ordinary rows so Vitest can make
 * deterministic assertions. Resource bindings are resolved once per runner.
 */
export async function createLiveSqlRunner(options: LiveSqlRunnerOptions): Promise<LiveSqlRunner> {
  const aliases = Object.entries(options.resources)
  if (!aliases.length) throw new Error('At least one live SQL resource alias is required')

  const mcpUrl = options.mcpUrl ?? (MCP_URL || readConfig().mcpUrl || '')
  if (!options.mcp) {
    if (!mcpUrl) throw new Error('RETOOL_MCP_URL is required for live SQL tests')
    if ((options.requireCachedAuth ?? true) && !hasCachedAuth(mcpUrl)) {
      throw new Error(
        `No cached OAuth token for ${new URL(mcpUrl).host}. Authorize once with the runner or probe before running live tests.`,
      )
    }
  }

  const ownsMcp = options.mcp === undefined
  const mcp = options.mcp ?? await connectMcp(mcpUrl)
  let bindings: ResourceBinding[]
  try {
    bindings = await mcp.getResourceBindings([...new Set(aliases.map(([, resourceId]) => resourceId))])
  } catch (error) {
    if (ownsMcp) await mcp.close()
    throw error
  }

  const resolved = new Map<string, { resourceId: string; binding: string }>()
  for (const [alias, resourceId] of aliases) {
    const binding = bindings.find((candidate) => candidate.resource_id === resourceId)?.variable_name
    if (!binding) {
      if (ownsMcp) await mcp.close()
      throw new Error(`MCP did not return a binding for live SQL resource "${alias}" (${resourceId})`)
    }
    resolved.set(alias, { resourceId, binding })
  }

  const runSql = async <T extends SqlRow = SqlRow>(resource: string, sql: string, params?: unknown[]): Promise<T[]> => {
    const target = resolved.get(resource)
    if (!target) throw new Error(`Unknown live SQL resource alias "${resource}"`)
    if (isWrite(sql)) throw new Error(`Live SQL tests are read-only; refused: ${sql.slice(0, 120)}`)
    if (params !== undefined && !Array.isArray(params)) throw new Error('SQL query parameters must be an array')

    const result = await mcp.executeResourceTs(
      [target.resourceId],
      buildSqlSnippet(target.binding, sql, params),
      options.environmentName,
    )
    return rowsFromResult<T>(result)
  }

  if (options.environmentGate) {
    try {
      const rows = await runSql(options.environmentGate.resource, options.environmentGate.sql)
      if (rows.length !== 1) {
        throw new Error(`expected exactly one gate row, received ${rows.length}`)
      }
      const mismatches = Object.entries(options.environmentGate.expected)
        .filter(([key, expected]) => !Object.is(rows[0][key], expected))
        .map(([key, expected]) => `${key}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(rows[0][key])}`)
      if (mismatches.length) throw new Error(mismatches.join('; '))
    } catch (error) {
      if (ownsMcp) await mcp.close()
      throw new Error(
        `Live SQL environment gate failed${options.environmentName ? ` for "${options.environmentName}"` : ''}: ` +
        String((error as Error)?.message ?? error),
      )
    }
  }

  return {
    runSql,
    async close() {
      if (ownsMcp) await mcp.close()
    },
  }
}
