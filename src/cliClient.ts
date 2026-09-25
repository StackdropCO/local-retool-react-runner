import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { McpClient, ResourceBinding } from './mcpClient.js'
import { runRetoolExplore, validateRetoolCheckout } from './retoolExplore.js'

type CachedResource = {
  name: string
  displayName?: string
  type?: string
  symbols?: string[]
}

type ResourceCache = {
  resources?: CachedResource[]
}

function readResourceCache(checkoutDir: string): CachedResource[] {
  validateRetoolCheckout(checkoutDir)
  const path = join(checkoutDir, '.retool', 'resource-cache.json')
  let cache: ResourceCache
  try {
    cache = JSON.parse(readFileSync(path, 'utf8')) as ResourceCache
  } catch (error) {
    throw new Error(
      `Cannot read Retool CLI resource cache at ${path}. Run \`retool pull\` in the checkout first: ` +
      String((error as Error)?.message ?? error),
    )
  }
  if (!Array.isArray(cache.resources)) throw new Error(`Invalid Retool CLI resource cache: ${path}`)
  return cache.resources
}

/**
 * MCP-compatible surface backed exclusively by the Retool CLI. Keeping this
 * interface lets the local runtime migrate without an execution fallback.
 */
export async function connectRetoolCli(
  checkoutDir: string,
  options: { allowMutative?: boolean; rows?: number } = {},
): Promise<McpClient> {
  const resources = readResourceCache(checkoutDir)
  const byId = new Map(resources.map((resource) => [resource.name, resource]))

  return {
    skipEnvironmentPreflight: true,
    async executeResourceTs(resourceNames, code, environmentName) {
      if (!environmentName) throw new Error('Retool CLI execution requires an explicit environment')
      const selected = resourceNames.map((resourceName) => {
        const resource = byId.get(resourceName)
        if (!resource) throw new Error(`Retool CLI checkout does not declare resource ${resourceName}`)
        if (!resource.symbols?.length) throw new Error(`Retool CLI resource ${resourceName} has no generated binding`)
        return resource
      })
      // Mention each selected binding so startup preflight validates that the
      // requested environment actually injects it, even when `code` is just
      // `return true`.
      const preflight = selected
        .flatMap((resource) => resource.symbols ?? [])
        .map((binding) => `void ${binding};`)
        .join('\n')
      const payload = await runRetoolExplore(`${preflight}\n${code}`, {
        checkoutDir,
        environmentName,
        rows: options.rows ?? 5000,
        allowMutative: options.allowMutative ?? false,
      })
      return payload.data
    },
    async getResourceBindings(resourceNames) {
      const bindings: ResourceBinding[] = []
      for (const resourceName of resourceNames) {
        const resource = byId.get(resourceName)
        if (!resource) continue
        for (const symbol of resource.symbols ?? []) {
          bindings.push({
            resource_id: resource.name,
            variable_name: symbol,
            type: resource.type ?? 'unknown',
            display_name: resource.displayName,
          })
        }
      }
      return bindings
    },
    async listResources(nameContains) {
      const needle = nameContains?.toLowerCase()
      return resources
        .filter((resource) => !needle || resource.displayName?.toLowerCase().includes(needle))
        .map((resource) => ({
          name: resource.name,
          displayName: resource.displayName,
          type: resource.type,
        }))
    },
    async listGroups() {
      throw new Error('Retool CLI does not expose group discovery')
    },
    async close() {},
  }
}
