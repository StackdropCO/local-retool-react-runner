import { logQuery } from './queryLog.js'
import { runRetoolExplore, type RetoolExplorePayload } from './retoolExplore.js'

export type ExploreRestRequest = {
  method?: string
  path: string
  headers?: Record<string, string>
  body?: unknown
}

export type ExploreRestEntry = {
  resourceName: string
  displayName: string
  binding: string
}

export type ExploreRunner = (
  code: string,
  options: {
    checkoutDir: string
    environmentName: string
    rows: number
    allowMutative: boolean
  },
) => Promise<RetoolExplorePayload>

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export function createExploreRestResource(
  entry: ExploreRestEntry,
  options: {
    checkoutDir: string
    environmentName: string
    writes: boolean
    endpoint: string
    rows?: number
    explore?: ExploreRunner
  },
): {
  rawRequest(request: ExploreRestRequest): Promise<unknown>
  query(request: ExploreRestRequest): Promise<unknown>
} {
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(entry.binding)) {
    throw new Error(`Invalid Retool resource binding: ${entry.binding}`)
  }
  const explore = options.explore ?? runRetoolExplore

  const execute = async (request: ExploreRestRequest) => {
    const method = String(request?.method ?? 'GET').toUpperCase()
    const path = String(request?.path ?? '')
    if (!path) throw new Error(`Retool REST resource ${entry.displayName} requires a path`)
    const mutative = !READ_METHODS.has(method)
    if (mutative && !options.writes) {
      throw new Error(`Write blocked (read-only mode). Retool REST method: ${method}`)
    }

    const normalizedRequest = { ...request, method, path }
    const code = `return await ${entry.binding}.rawRequest(${JSON.stringify(normalizedRequest)})`
    const started = Date.now()
    const ts = new Date(started).toISOString()
    const safePath = path.split('?', 1)[0].replace(/[\r\n]/g, '')
    const logCode = `RETOOL EXPLORE REST ${method} ${safePath}`
    try {
      const payload = await explore(code, {
        checkoutDir: options.checkoutDir,
        environmentName: options.environmentName,
        rows: options.rows ?? 5000,
        // Retool Explore classifies rawRequest itself as mutative because it
        // cannot infer the HTTP method from the argument. We enforce the
        // method-level write gate above, then permit the validated request.
        allowMutative: true,
      })
      const result = payload.data
      const rows = result && typeof result === 'object' ? (result as { data?: unknown }).data : undefined
      logQuery({
        ts,
        endpoint: options.endpoint,
        resourceNames: [entry.resourceName],
        code: logCode,
        ok: true,
        rowCount: Array.isArray(rows) ? rows.length : undefined,
        durationMs: Date.now() - started,
      })
      return result
    } catch (error) {
      logQuery({
        ts,
        endpoint: options.endpoint,
        resourceNames: [entry.resourceName],
        code: logCode,
        ok: false,
        error: String((error as Error)?.message ?? error),
        durationMs: Date.now() - started,
      })
      throw error
    }
  }

  return { rawRequest: execute, query: execute }
}
