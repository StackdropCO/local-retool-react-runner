import type { McpClient } from './mcpClient.js'

// Retool's MCP TypeScript executor supports generated query bindings for these
// resource families. A plain `restapi` cache entry is deliberately absent:
// base-URL-only REST resources have a CLI binding but MCP refuses to execute it,
// and the CLI cache does not distinguish those from OpenAPI-enriched REST.
const MCP_TYPESCRIPT_RESOURCE_TYPES = new Set([
  'databricks',
  'databricksLakebase',
  'postgresql',
  'mysql',
  'sqlserver',
  'snowflake',
  'redshift',
  'bigquery',
])

/**
 * Route operations by proven behavior rather than by resource provider.
 *
 * A call reaches MCP only after the caller has positively classified it as a
 * read. Everything else stays on the CLI, where Retool's mutation classifier
 * and the runner's --writes gate remain authoritative.
 */
export function createAutoClient(cli: McpClient, mcp: McpClient): McpClient {
  return {
    // Resource definitions come from the isolated CLI sidecar, so environment
    // availability is still validated by each real execution.
    skipEnvironmentPreflight: true,
    async executeResourceTs(resourceNames, code, environmentName, options) {
      let mcpCapable = false
      if (options?.safeRead === true) {
        const bindings = await cli.getResourceBindings(resourceNames)
        const typesByResource = new Map(bindings.map((binding) => [binding.resource_id, binding.type]))
        mcpCapable = resourceNames.length > 0 && resourceNames.every((resourceName) => {
          const type = typesByResource.get(resourceName)
          return type !== undefined && MCP_TYPESCRIPT_RESOURCE_TYPES.has(type)
        })
      }
      const transport = options?.safeRead === true && mcpCapable ? mcp : cli
      return await transport.executeResourceTs(resourceNames, code, environmentName, options)
    },
    async batchCalls(fn) {
      // The CLI client coalesces ambiguous/write calls created during fn.
      // Safe reads bypass that batch and run concurrently over persistent MCP.
      return cli.batchCalls ? await cli.batchCalls(fn) : await fn()
    },
    async getResourceBindings(resourceNames) {
      return await cli.getResourceBindings(resourceNames)
    },
    async listResources(nameContains) {
      return await cli.listResources(nameContains)
    },
    async listGroups() {
      return await mcp.listGroups()
    },
    async close() {
      const results = await Promise.allSettled([cli.close(), mcp.close()])
      const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
      if (failed) throw failed.reason
    },
  }
}
