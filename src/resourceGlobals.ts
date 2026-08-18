import type { McpClient } from './mcpClient.js'
import ts from 'typescript'
import { isWrite, buildSqlSnippet, buildRestSnippet } from './snippets.js'
import { logQuery } from './queryLog.js'
import type { LocalResourceMap } from './localResourceConfig.js'
import { createLocalRestResource } from './localRestResource.js'

export class WriteBlockedError extends Error {
  constructor(sql: string) {
    super(`Write blocked (read-only mode). Pass --writes to enable.\nSQL: ${sql.slice(0, 200)}`)
    this.name = 'WriteBlockedError'
  }
}

export type ResourceRef = { name: string; displayName: string; type: string }
export type ResourceEntry = {
  resourceName: string
  displayName: string
  mcpBinding: string
  sourceBindings: string[]
  executionBindings: string[]
  kind: 'sql' | 'rest'
}
export type ResourceMap = Record<string, ResourceEntry>

export function validateLocalResourceBindings(map: ResourceMap, localResources: LocalResourceMap): void {
  for (const [resourceId, definition] of Object.entries(localResources)) {
    const entry = map[resourceId]
    if (!entry) throw new Error(`Local REST resource ${resourceId} is not present in the resolved app resources`)
    if (!entry.sourceBindings.includes(definition.binding)) {
      throw new Error(
        `Local REST binding "${definition.binding}" for ${resourceId} is not a source alias for ${entry.displayName}`,
      )
    }
  }
}

const camel = (s: string) =>
  s
    .replace(/[^a-zA-Z0-9]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ''))
    .replace(/^([A-Z])/, (m) => m.toLowerCase())

function identifiersByLowercase(sourceTexts: string[]): Map<string, Set<string>> {
  const identifiers = new Map<string, Set<string>>()
  for (const [index, text] of sourceTexts.entries()) {
    const source = ts.createSourceFile(`resource-source-${index}.ts`, text, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS)
    const visit = (node: ts.Node) => {
      if (ts.isIdentifier(node)) {
        const names = identifiers.get(node.text.toLowerCase()) ?? new Set<string>()
        names.add(node.text)
        identifiers.set(node.text.toLowerCase(), names)
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  return identifiers
}

// The app's resourceReferencesByFile already gives Resource.name (the UUID);
// we only need the MCP to tell us the binding variable name per resource.
export async function resolveResources(mcp: McpClient, refs: ResourceRef[], sourceTexts: string[] = []): Promise<ResourceMap> {
  const unique = new Map<string, ResourceRef>()
  for (const r of refs) if (!unique.has(r.name)) unique.set(r.name, r)
  const list = [...unique.values()]

  let bindings: Awaited<ReturnType<McpClient['getResourceBindings']>> = []
  try {
    bindings = await mcp.getResourceBindings(list.map((r) => r.name))
  } catch {
    /* fall back to camelCase bindings below */
  }

  const sourceIdentifiers = identifiersByLowercase(sourceTexts)
  const entries = list.map((ref): ResourceEntry => {
    const binding = bindings.find((item) => item.resource_id === ref.name)?.variable_name ?? camel(ref.displayName)
    const sourceBindings = [...(sourceIdentifiers.get(binding.toLowerCase()) ?? [])]
    return {
      resourceName: ref.name,
      displayName: ref.displayName,
      mcpBinding: binding,
      sourceBindings: [...new Set([binding, ...sourceBindings])],
      // Retool's generated definition can disagree with the variable its
      // executor injects (including case). The checked-in app source is the
      // authoritative first choice; retain the generated spelling as a safe
      // fallback for resources that have no source occurrence.
      executionBindings: [...new Set([...sourceBindings, binding])],
      kind: ref.type === 'restapi' || ref.type === 'slackopenapi' ? 'rest' : 'sql',
    }
  })

  const owners = new Map<string, ResourceEntry[]>()
  for (const entry of entries) {
    for (const sourceBinding of entry.sourceBindings) {
      const matches = owners.get(sourceBinding) ?? []
      matches.push(entry)
      owners.set(sourceBinding, matches)
    }
  }
  for (const [sourceBinding, matches] of owners) {
    const resourceIds = new Set(matches.map((entry) => entry.resourceName))
    if (resourceIds.size > 1) {
      throw new Error(
        `Ambiguous resource binding "${sourceBinding}" matches multiple resource UUIDs: ` +
          matches.map((entry) => `${entry.displayName} (${entry.resourceName})`).join(', '),
      )
    }
  }

  const map: ResourceMap = {}
  for (const entry of entries) map[entry.resourceName] = entry
  return map
}

export function buildGlobals(
  mcp: McpClient,
  map: ResourceMap,
  opts: {
    writes: boolean
    endpoint: string
    normalize: (raw: unknown) => unknown
    environmentName?: string
    localResources?: LocalResourceMap
    localFetchImpl?: typeof fetch
  },
): Record<string, unknown> {
  const globals: Record<string, unknown> = {}
  validateLocalResourceBindings(map, opts.localResources ?? {})
  const run = async (entry: ResourceEntry, codeForBinding: (binding: string) => string) => {
    const started = Date.now()
    const ts = new Date(started).toISOString()
    const resourceNames = [entry.resourceName]
    const bindings = entry.executionBindings.length ? entry.executionBindings : [entry.mcpBinding]
    for (const [index, binding] of bindings.entries()) {
      const code = codeForBinding(binding)
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
        const message = String((err as Error)?.message ?? err)
        const canRetry = index < bindings.length - 1 && message.includes(`${binding} is not defined`)
        if (canRetry) continue
        logQuery({
          ts,
          endpoint: opts.endpoint,
          resourceNames,
          code,
          ok: false,
          error: message,
          durationMs: Date.now() - started,
        })
        throw err
      }
    }
    throw new Error(`No executable binding found for ${entry.displayName} (${entry.resourceName})`)
  }

  for (const entry of Object.values(map)) {
    const localDefinition = opts.localResources?.[entry.resourceName]
    if (localDefinition) {
      const proxy = createLocalRestResource(localDefinition, {
        writes: opts.writes,
        endpoint: opts.endpoint,
        fetchImpl: opts.localFetchImpl,
      })
      for (const binding of entry.sourceBindings) globals[binding] = proxy
      continue
    }
    if (entry.kind === 'sql') {
      const proxy = {
        query: async (sql: string, params?: unknown[]) => {
          if (!opts.writes && isWrite(sql)) throw new WriteBlockedError(sql)
          if (params !== undefined && !Array.isArray(params)) throw new Error('SQL query parameters must be an array')
          return run(entry, (binding) => buildSqlSnippet(binding, sql, params))
        },
      }
      for (const binding of entry.sourceBindings) globals[binding] = proxy
    } else {
      const makeProxy = (path: string[]): any =>
        new Proxy(function () {} as any, {
          get: (_t, prop: string) => makeProxy([...path, prop]),
          apply: (_t, _this, args: unknown[]) => run(entry, (binding) => buildRestSnippet(binding, path, args)),
        })
      const proxy = makeProxy([])
      for (const binding of entry.sourceBindings) globals[binding] = proxy
    }
  }
  return globals
}
