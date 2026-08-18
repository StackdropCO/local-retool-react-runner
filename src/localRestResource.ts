import type { LocalResourceDefinition, LocalResourceOperation } from './localResourceConfig.js'
import { logQuery } from './queryLog.js'

export type LocalRestRequest = {
  method?: string
  path: string
  headers?: Record<string, string>
  body?: BodyInit | Buffer
}

export type LocalRestResponse = {
  status: number
  headers: Record<string, string>
  data: unknown
}

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

function safeOperation(definition: LocalResourceDefinition, method: string, path: string): LocalResourceOperation {
  if (!path.startsWith('/') || path.startsWith('//') || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(path)) {
    throw new Error(`Local REST resource ${definition.binding} requires a relative root path`)
  }
  const url = new URL(path, definition.baseUrl)
  if (url.origin !== definition.baseUrl.origin || url.username || url.password) {
    throw new Error(`Local REST resource ${definition.binding} requires a relative root path on its configured origin`)
  }
  const operation = definition.operations.find((candidate) =>
    candidate.method === method && candidate.pattern.test(url.pathname))
  if (!operation) throw new Error(`Method or path is not allowed for local REST resource ${definition.binding}`)
  return operation
}

function requestHeaders(operation: LocalResourceOperation, request: LocalRestRequest): Headers {
  const headers = new Headers(request.headers)
  if (request.body !== undefined && !headers.has('content-type') && operation.requestContentTypes.length === 1) {
    headers.set('content-type', operation.requestContentTypes[0])
  }
  const contentType = headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase()
  if (contentType && operation.requestContentTypes.length &&
      !operation.requestContentTypes.some((allowed) => allowed.toLowerCase() === contentType)) {
    throw new Error(`Content type is not allowed for local REST operation ${operation.method} ${operation.template}`)
  }
  return headers
}

async function responseData(response: Response): Promise<unknown> {
  if (response.status === 204 || response.status === 205 || response.body === null) return null
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
  if (contentType.includes('application/json') || contentType.includes('+json')) return response.json()
  return response.text()
}

export function createLocalRestResource(
  definition: LocalResourceDefinition,
  options: { writes: boolean; endpoint: string; fetchImpl?: typeof fetch },
): { query(request: LocalRestRequest): Promise<LocalRestResponse> } {
  const fetchImpl = options.fetchImpl ?? fetch
  return {
    async query(request) {
      const method = String(request?.method ?? 'GET').toUpperCase()
      const operation = safeOperation(definition, method, String(request?.path ?? ''))
      if (!options.writes && !READ_METHODS.has(method)) {
        throw new Error(`Write blocked (read-only mode). Local REST method: ${method}`)
      }
      const headers = requestHeaders(operation, request)
      const url = new URL(request.path, definition.baseUrl)
      const started = Date.now()
      const ts = new Date(started).toISOString()
      const code = `LOCAL REST ${operation.method} ${operation.template}`
      try {
        const response = await fetchImpl(url, {
          method,
          headers,
          body: request.body as BodyInit | null | undefined,
          redirect: 'manual',
        })
        if (response.status >= 300 && response.status < 400) {
          throw new Error(`Redirect refused for local REST resource ${definition.binding}`)
        }
        const result = {
          status: response.status,
          headers: Object.fromEntries(response.headers.entries()),
          data: await responseData(response),
        }
        logQuery({
          ts,
          endpoint: options.endpoint,
          resourceNames: [definition.resourceId],
          code,
          ok: response.ok,
          error: response.ok ? undefined : `HTTP ${response.status}`,
          durationMs: Date.now() - started,
        })
        return result
      } catch (error) {
        const message = String((error as Error)?.message ?? error)
        const safeMessage = message.startsWith('Redirect refused')
          ? message
          : `Local REST request failed for ${definition.binding}`
        logQuery({
          ts,
          endpoint: options.endpoint,
          resourceNames: [definition.resourceId],
          code,
          ok: false,
          error: safeMessage,
          durationMs: Date.now() - started,
        })
        throw new Error(safeMessage)
      }
    },
  }
}
