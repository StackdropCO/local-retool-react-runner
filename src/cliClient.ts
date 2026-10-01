import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { AsyncLocalStorage } from 'node:async_hooks'
import type { McpClient, ResourceBinding } from './mcpClient.js'
import { DEFAULT_EXPLORE_ROWS, runRetoolExplore, validateRetoolCheckout, type RetoolExploreOptions, type RetoolExplorePayload } from './retoolExplore.js'

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
  options: {
    allowMutative?: boolean
    rows?: number
    explore?: (code: string, options: RetoolExploreOptions) => Promise<RetoolExplorePayload>
  } = {},
): Promise<McpClient> {
  const resources = readResourceCache(checkoutDir)
  const byId = new Map(resources.map((resource) => [resource.name, resource]))
  const explore = options.explore ?? runRetoolExplore
  type PendingCall = {
    resources: CachedResource[]
    code: string
    environmentName: string
    allowMutative: boolean
    safeRead: boolean
    resolve(value: unknown): void
    reject(error: unknown): void
  }
  type Batch = { pending: PendingCall[]; scheduled: boolean }
  const batches = new AsyncLocalStorage<Batch>()

  const selectResources = (resourceNames: string[]) => resourceNames.map((resourceName) => {
    const resource = byId.get(resourceName)
    if (!resource) throw new Error(`Retool CLI checkout does not declare resource ${resourceName}`)
    if (!resource.symbols?.length) throw new Error(`Retool CLI resource ${resourceName} has no generated binding`)
    return resource
  })

  const preflightFor = (selected: CachedResource[]) => [...new Set(
    selected.flatMap((resource) => resource.symbols ?? []),
  )].map((binding) => `void ${binding};`).join('\n')

  const execute = async (calls: PendingCall[]): Promise<void> => {
    const environmentName = calls[0]!.environmentName
    if (calls.some((call) => call.environmentName !== environmentName)) {
      const error = new Error('Cannot batch Retool CLI calls for different environments')
      for (const call of calls) call.reject(error)
      return
    }
    const selected = [...new Map(
      calls.flatMap((call) => call.resources).map((resource) => [resource.name, resource]),
    ).values()]
    const tasks = calls.map((call) => `
      (async () => {
        try {
          return { ok: true, value: await (async () => { ${call.code} })() }
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : String(error) }
        }
      })()`)
    const code = calls.length === 1
      ? `${preflightFor(selected)}\n${calls[0]!.code}`
      : `${preflightFor(selected)}\nreturn await Promise.all([${tasks.join(',')}\n])`
    try {
      const payload = await explore(code, {
        checkoutDir,
        environmentName,
        rows: options.rows ?? DEFAULT_EXPLORE_ROWS,
        allowMutative: options.allowMutative === true || calls.some((call) => call.allowMutative),
      })
      if (calls.length === 1) {
        calls[0]!.resolve(payload.data)
        return
      }
      if (!Array.isArray(payload.data) || payload.data.length !== calls.length) {
        throw new Error('Retool CLI batch returned an unexpected result shape')
      }
      payload.data.forEach((item, index) => {
        const result = item as { ok?: boolean; value?: unknown; error?: unknown }
        if (result?.ok) calls[index]!.resolve(result.value)
        else calls[index]!.reject(new Error(String(result?.error ?? 'Retool CLI batch call failed')))
      })
    } catch (error) {
      for (const call of calls) call.reject(error)
    }
  }

  const flush = (batch: Batch) => {
    batch.scheduled = false
    const calls = batch.pending.splice(0)
    if (!calls.length) return
    if (options.allowMutative) {
      void execute(calls)
      return
    }
    // A validated raw GET needs --allow-mutative because Explore cannot infer
    // its method. Never let that transport override authorize an unrelated,
    // unclassified REST operation in the same read-only invocation.
    const safeReads = calls.filter((call) => call.safeRead)
    const classifiedByCli = calls.filter((call) => !call.safeRead)
    if (safeReads.length) void execute(safeReads)
    if (classifiedByCli.length) void execute(classifiedByCli)
  }

  return {
    skipEnvironmentPreflight: true,
    async executeResourceTs(resourceNames, code, environmentName, executionOptions) {
      if (!environmentName) throw new Error('Retool CLI execution requires an explicit environment')
      const selected = selectResources(resourceNames)
      const batch = batches.getStore()
      if (!batch) {
        const payload = await explore(`${preflightFor(selected)}\n${code}`, {
          checkoutDir,
          environmentName,
          rows: options.rows ?? DEFAULT_EXPLORE_ROWS,
          allowMutative: options.allowMutative === true || executionOptions?.allowMutative === true,
        })
        return payload.data
      }
      return await new Promise<unknown>((resolve, reject) => {
        batch.pending.push({
          resources: selected,
          code,
          environmentName,
          allowMutative: executionOptions?.allowMutative === true,
          safeRead: executionOptions?.safeRead === true,
          resolve,
          reject,
        })
        if (!batch.scheduled) {
          batch.scheduled = true
          queueMicrotask(() => flush(batch))
        }
      })
    },
    async batchCalls(fn) {
      return await batches.run({ pending: [], scheduled: false }, fn)
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
