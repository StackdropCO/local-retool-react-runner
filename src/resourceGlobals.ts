import type { McpClient } from './mcpClient.js'
import { isWrite, buildSqlSnippet, buildRestSnippet } from './snippets.js'
import { logQuery } from './queryLog.js'

export class WriteBlockedError extends Error {
  constructor(sql: string) {
    super(`Write blocked (read-only mode). Pass --writes to enable.\nSQL: ${sql.slice(0, 200)}`)
    this.name = 'WriteBlockedError'
  }
}

export type ResourceRef = { name: string; displayName: string; type: string }
export type ResourceMap = Record<string, { resourceName: string; binding: string; kind: 'sql' | 'rest' }>

const camel = (s: string) =>
  s
    .replace(/[^a-zA-Z0-9]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ''))
    .replace(/^([A-Z])/, (m) => m.toLowerCase())

// The app's resourceReferencesByFile already gives Resource.name (the UUID);
// we only need the MCP to tell us the binding variable name per resource.
export async function resolveResources(mcp: McpClient, refs: ResourceRef[]): Promise<ResourceMap> {
  const unique = new Map<string, ResourceRef>()
  for (const r of refs) if (!unique.has(r.displayName)) unique.set(r.displayName, r)
  const list = [...unique.values()]

  let bindings: Awaited<ReturnType<McpClient['getResourceBindings']>> = []
  try {
    bindings = await mcp.getResourceBindings(list.map((r) => r.name))
  } catch {
    /* fall back to camelCase bindings below */
  }

  const map: ResourceMap = {}
  for (const ref of list) {
    const b = bindings.find((x) => x.resource_id === ref.name)
    map[ref.displayName] = {
      resourceName: ref.name,
      binding: b?.variable_name ?? camel(ref.displayName),
      kind: ref.type === 'restapi' ? 'rest' : 'sql',
    }
  }
  return map
}

export function buildGlobals(
  mcp: McpClient,
  map: ResourceMap,
  opts: { writes: boolean; endpoint: string; normalize: (raw: unknown) => unknown; environmentName?: string },
): Record<string, unknown> {
  const globals: Record<string, unknown> = {}
  const run = async (code: string, resourceNames: string[]) => {
    const started = Date.now()
    const ts = new Date(started).toISOString()
    try {
      const raw = await mcp.executeResourceTs(resourceNames, code, opts.environmentName)
      const out = opts.normalize(raw)
      const rows = (out as any)?.data
      logQuery({
        ts,
        endpoint: opts.endpoint,
        resourceNames,
        code,
        ok: true,
        rowCount: Array.isArray(rows) ? rows.length : undefined,
        durationMs: Date.now() - started,
      })
      return out
    } catch (err) {
      logQuery({
        ts,
        endpoint: opts.endpoint,
        resourceNames,
        code,
        ok: false,
        error: String((err as Error)?.message ?? err),
        durationMs: Date.now() - started,
      })
      throw err
    }
  }

  for (const entry of Object.values(map)) {
    if (entry.kind === 'sql') {
      globals[entry.binding] = {
        query: async (sql: string) => {
          if (!opts.writes && isWrite(sql)) throw new WriteBlockedError(sql)
          return run(buildSqlSnippet(entry.binding, sql), [entry.resourceName])
        },
      }
    } else {
      const makeProxy = (path: string[]): any =>
        new Proxy(function () {} as any, {
          get: (_t, prop: string) => makeProxy([...path, prop]),
          apply: (_t, _this, args: unknown[]) => run(buildRestSnippet(entry.binding, path, args), [entry.resourceName]),
        })
      globals[entry.binding] = makeProxy([])
    }
  }
  return globals
}
