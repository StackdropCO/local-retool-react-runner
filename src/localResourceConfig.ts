import { createHash } from 'node:crypto'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { TOOL_ROOT } from './paths.js'

export type LocalResourceOperation = {
  method: string
  template: string
  pattern: RegExp
  requestContentTypes: string[]
}

export type LocalResourceDefinition = {
  resourceId: string
  binding: string
  baseUrl: URL
  specPath: string
  specHash: string
  operations: LocalResourceOperation[]
}

export type LocalResourceMap = Record<string, LocalResourceDefinition>

export type LocalResourceEntry = Omit<LocalResourceDefinition, 'specHash' | 'operations'>
export type LocalResourceEntryMap = Record<string, LocalResourceEntry>

const HTTP_METHODS = new Set(['get', 'head', 'options', 'post', 'put', 'patch', 'delete'])

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

function exactFields(value: Record<string, unknown>, allowed: string[], label: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key))
  if (unknown.length) throw new Error(`${label} has unknown field${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}`)
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`)
  return value.trim()
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function compilePath(template: string, greedyParameters: Set<string>): RegExp {
  if (!template.startsWith('/') || template.includes('?') || template.includes('#')) {
    throw new Error(`OpenAPI path must be an absolute pathname: ${template}`)
  }
  const segments = template.split('/')
  const parts = segments.map((segment, index) => {
    if (index === 0) return ''
    const parameter = segment.match(/^\{([A-Za-z_][A-Za-z0-9_-]*)\}$/)?.[1]
    if (parameter) {
      if (greedyParameters.has(parameter)) {
        if (index !== segments.length - 1) throw new Error(`Reserved path parameter must be final: ${template}`)
        return '.+'
      }
      return '[^/]+'
    }
    if (segment.includes('{') || segment.includes('}')) throw new Error(`Unsupported OpenAPI path parameter: ${template}`)
    return escapeRegExp(segment)
  })
  return new RegExp(`^${parts.join('/')}$`)
}

function reservedPathParameters(rawParameters: unknown, label: string): Set<string> {
  if (rawParameters === undefined) return new Set()
  if (!Array.isArray(rawParameters)) throw new Error(`${label} parameters must be an array`)
  const names = new Set<string>()
  for (const [index, rawParameter] of rawParameters.entries()) {
    const parameter = object(rawParameter, `${label} parameter ${index}`)
    if (parameter.in === 'path' && parameter.allowReserved === true) {
      names.add(requiredString(parameter.name, `${label} parameter ${index} name`))
    }
  }
  return names
}

function parseDocument(path: string, source: string): Record<string, unknown> {
  try {
    return object(extname(path).toLowerCase() === '.json' ? JSON.parse(source) : parseYaml(source), `OpenAPI document ${path}`)
  } catch (error) {
    throw new Error(`Unable to parse OpenAPI document ${path}: ${String((error as Error)?.message ?? error)}`)
  }
}

function compileOperations(document: Record<string, unknown>, baseUrl: URL): LocalResourceOperation[] {
  const openapi = requiredString(document.openapi, 'OpenAPI version')
  if (!/^3\./.test(openapi)) throw new Error(`Unsupported OpenAPI version ${openapi}; expected 3.x`)

  const servers = Array.isArray(document.servers) ? document.servers : []
  if (!servers.length) throw new Error('OpenAPI document must declare at least one server')
  const serverOrigins = servers.map((server, index) => {
    const url = new URL(requiredString(object(server, `OpenAPI server ${index}`).url, `OpenAPI server ${index} URL`))
    if (url.protocol !== 'https:') throw new Error(`OpenAPI server must use HTTPS: ${url.href}`)
    return url.origin
  })
  if (!serverOrigins.includes(baseUrl.origin)) {
    throw new Error(`OpenAPI server does not match configured base URL origin ${baseUrl.origin}`)
  }

  const paths = object(document.paths, 'OpenAPI paths')
  const operations: LocalResourceOperation[] = []
  const seen = new Set<string>()
  for (const [template, rawPath] of Object.entries(paths)) {
    const path = object(rawPath, `OpenAPI path ${template}`)
    const pathReserved = reservedPathParameters(path.parameters, `OpenAPI path ${template}`)
    for (const [method, rawOperation] of Object.entries(path)) {
      if (!HTTP_METHODS.has(method.toLowerCase())) continue
      const key = `${method.toUpperCase()} ${template}`
      if (seen.has(key)) throw new Error(`Duplicate OpenAPI operation ${key}`)
      seen.add(key)
      const operation = object(rawOperation, `OpenAPI operation ${key}`)
      const operationReserved = reservedPathParameters(operation.parameters, `OpenAPI operation ${key}`)
      const pattern = compilePath(template, new Set([...pathReserved, ...operationReserved]))
      const requestBody = operation.requestBody ? object(operation.requestBody, `${key} requestBody`) : undefined
      const content = requestBody?.content ? object(requestBody.content, `${key} request content`) : {}
      operations.push({
        method: method.toUpperCase(),
        template,
        pattern,
        requestContentTypes: Object.keys(content),
      })
    }
  }
  if (!operations.length) throw new Error('OpenAPI document has no supported operations')
  return operations
}

export function validateLocalResourceSpec(
  specPath: string,
  source: string,
  baseUrl: URL,
): Pick<LocalResourceDefinition, 'specHash' | 'operations'> {
  return {
    specHash: createHash('sha256').update(source).digest('hex'),
    operations: compileOperations(parseDocument(specPath, source), baseUrl),
  }
}

export function loadLocalResourceEntries(options: {
  directory?: string
  appResourceIds?: Set<string>
} = {}): LocalResourceEntryMap {
  const directory = options.directory ?? resolve(TOOL_ROOT, '.local-resources')
  const registryPath = resolve(directory, 'resources.json')
  if (!existsSync(registryPath)) return {}

  const root = realpathSync(directory)
  const registry = object(JSON.parse(readFileSync(registryPath, 'utf8')), 'Local resource registry')
  exactFields(registry, ['version', 'resources'], 'Local resource registry')
  if (registry.version !== 1) throw new Error(`Unsupported local resource registry version ${String(registry.version)}`)
  const resources = object(registry.resources, 'Local resource registry resources')
  const entries: LocalResourceEntryMap = {}

  for (const [resourceId, rawEntry] of Object.entries(resources)) {
    if (options.appResourceIds && !options.appResourceIds.has(resourceId)) {
      throw new Error(`Local resource ${resourceId} is not referenced by this app`)
    }
    const entry = object(rawEntry, `Local resource ${resourceId}`)
    exactFields(entry, ['binding', 'spec', 'baseUrl'], `Local resource ${resourceId}`)
    const binding = requiredString(entry.binding, `Local resource ${resourceId} binding`)
    const spec = requiredString(entry.spec, `Local resource ${resourceId} spec`)
    if (isAbsolute(spec)) throw new Error(`Local resource ${resourceId} spec must be relative to the local resource directory`)
    const unresolvedSpecPath = resolve(root, spec)
    const specPath = realpathSync(unresolvedSpecPath)
    const fromRoot = relative(root, specPath)
    if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
      throw new Error(`Local resource ${resourceId} spec is outside the local resource directory`)
    }
    const baseUrl = new URL(requiredString(entry.baseUrl, `Local resource ${resourceId} baseUrl`))
    if (baseUrl.protocol !== 'https:') throw new Error(`Local resource ${resourceId} base URL must use HTTPS`)
    if (baseUrl.username || baseUrl.password) throw new Error(`Local resource ${resourceId} base URL must not contain credentials`)
    entries[resourceId] = {
      resourceId,
      binding,
      baseUrl,
      specPath,
    }
  }
  return entries
}

export function loadLocalResourceDefinitions(options: {
  directory?: string
  appResourceIds?: Set<string>
} = {}): LocalResourceMap {
  return Object.fromEntries(Object.entries(loadLocalResourceEntries(options)).map(([resourceId, entry]) => {
    const source = readFileSync(entry.specPath, 'utf8')
    return [resourceId, {
      ...entry,
      ...validateLocalResourceSpec(entry.specPath, source, entry.baseUrl),
    }]
  }))
}
