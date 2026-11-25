import { readFileSync, readdirSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import vm from 'node:vm'
import { createHmac as cryptoCreateHmac, timingSafeEqual as cryptoTimingSafeEqual } from 'node:crypto'
import { parse as parseYaml } from 'yaml'
import { isWrite } from './snippets.js'
import { createDisposablePostgres, type DisposablePostgres } from './disposablePostgres.js'

export type WorkflowRunMode = 'dry-run' | 'mock' | 'docker'

export type WorkflowBlock = {
  id: string
  subtype?: string
  resourceName?: string
  resourceDisplayName?: string
  template?: Record<string, unknown>
  blockData: {
    uuid: string
    blockType: string
    editorType?: string
    incomingOnSuccessEdges?: string[]
    incomingPorts?: Array<{ blockId: string; portId: string }>
    outgoingPorts?: Array<{ id: string; name: string }>
    options?: Record<string, unknown>
  }
}

export type WorkflowDefinition = {
  directory: string
  id: string
  name: string
  blocks: WorkflowBlock[]
  byId: Map<string, WorkflowBlock>
  byUuid: Map<string, WorkflowBlock>
}

export type WorkflowFixture = {
  version: 1
  trigger?: unknown
  headers?: Record<string, string>
  configVars?: Record<string, unknown>
  blocks?: Record<string, { result: unknown; metadata?: unknown }>
  postgres?: {
    schema?: string[]
    seed?: string[]
  }
}

export type WorkflowPlanBlock = {
  id: string
  blockType: string
  editorType: string
  resourceId?: string
  operation: 'trigger' | 'code' | 'condition' | 'response' | 'sql' | 'rest' | 'resource'
  mutative: boolean
  supported: boolean
  predecessors: string[]
}

export type WorkflowPlan = {
  workflowId: string
  name: string
  blocks: WorkflowPlanBlock[]
  errors: string[]
  warnings: string[]
}

export type WorkflowBlockRun = {
  id: string
  status: 'success' | 'failed' | 'skipped'
  durationMs: number
  data?: unknown
  error?: string
  selectedPath?: string
  /** The SQL or HTTP request the block would have sent, with templates rendered. */
  request?: unknown
}

export type WorkflowRunResult = {
  mode: Exclude<WorkflowRunMode, 'dry-run'>
  workflowId: string
  status: 'success' | 'failed'
  response?: { status: number; body: unknown }
  blocks: WorkflowBlockRun[]
}

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

function workflowYamlFiles(directory: string): string[] {
  return readdirSync(directory)
    .filter((file) => file.endsWith('.yml') && file !== 'workflow.yml')
    .map((file) => join(directory, file))
}

export function loadWorkflow(directory: string): WorkflowDefinition {
  const root = resolve(directory)
  const metadata = object(parseYaml(readFileSync(join(root, 'workflow.yml'), 'utf8')), 'workflow.yml')
  const blocks = workflowYamlFiles(root).flatMap((path) => {
    const parsed = parseYaml(readFileSync(path, 'utf8')) as WorkflowBlock
    return parsed?.id && parsed?.blockData?.uuid ? [parsed] : []
  })
  const byId = new Map<string, WorkflowBlock>()
  const byUuid = new Map<string, WorkflowBlock>()
  for (const block of blocks) {
    if (byId.has(block.id)) throw new Error(`Duplicate workflow block id: ${block.id}`)
    if (byUuid.has(block.blockData.uuid)) throw new Error(`Duplicate workflow block UUID: ${block.blockData.uuid}`)
    byId.set(block.id, block)
    byUuid.set(block.blockData.uuid, block)
  }
  const id = String(metadata.workflowId ?? basename(root))
  return { directory: root, id, name: String(metadata.name ?? basename(root)), blocks, byId, byUuid }
}

export function operationFor(block: WorkflowBlock): WorkflowPlanBlock['operation'] {
  if (block.blockData.blockType === 'webhook') return 'trigger'
  if (block.blockData.blockType === 'conditional') return 'condition'
  if (block.blockData.blockType === 'webhookReturn') return 'response'
  if (block.subtype === 'JavascriptQuery') return 'code'
  if (block.subtype === 'SqlQuery' || block.subtype === 'SqlQueryUnified') return 'sql'
  if (block.subtype === 'RESTQuery') return 'rest'
  return 'resource'
}

function isMutativeBlock(block: WorkflowBlock): boolean {
  const operation = operationFor(block)
  if (operation === 'sql') return isWrite(String(block.template?.query ?? ''))
  if (operation === 'rest') return !READ_METHODS.has(String(block.template?.type ?? 'GET').toUpperCase())
  if (operation === 'resource') return true
  return false
}

function predecessorIds(workflow: WorkflowDefinition, block: WorkflowBlock): string[] {
  const direct = block.blockData.incomingOnSuccessEdges ?? []
  const conditional = (block.blockData.incomingPorts ?? []).map((edge) => edge.blockId)
  return [...new Set([...direct, ...conditional])].map((uuid) => workflow.byUuid.get(uuid)?.id ?? `missing:${uuid}`)
}

export function planWorkflow(workflow: WorkflowDefinition): WorkflowPlan {
  const errors: string[] = []
  const warnings: string[] = []
  const starts = workflow.blocks.filter((block) => operationFor(block) === 'trigger')
  if (starts.length !== 1) errors.push(`Expected exactly one webhook start block, found ${starts.length}`)
  const blocks = workflow.blocks.map((block): WorkflowPlanBlock => {
    const operation = operationFor(block)
    const predecessors = predecessorIds(workflow, block)
    for (const predecessor of predecessors) {
      if (predecessor.startsWith('missing:')) errors.push(`${block.id} references unknown predecessor ${predecessor.slice(8)}`)
    }
    const supported = operation !== 'resource'
    if (!supported) warnings.push(`${block.id} uses unsupported resource subtype ${block.subtype ?? 'unknown'}`)
    return {
      id: block.id,
      blockType: block.blockData.blockType,
      editorType: block.subtype ?? block.blockData.editorType ?? 'unknown',
      ...(block.resourceName ? { resourceId: block.resourceName } : {}),
      operation,
      mutative: isMutativeBlock(block),
      supported,
      predecessors,
    }
  })
  return { workflowId: workflow.id, name: workflow.name, blocks, errors: [...new Set(errors)], warnings }
}

export function loadWorkflowFixture(path: string): WorkflowFixture {
  const parsed = parseYaml(readFileSync(path, 'utf8')) as WorkflowFixture
  if (parsed?.version !== 1) throw new Error('Workflow fixture version must be 1')
  return parsed
}

function contextValues(
  allBlockIds: string[],
  results: Map<string, unknown>,
  configVars: Record<string, unknown>,
  triggerId: string,
  headers: Record<string, string>,
  metadata: Map<string, unknown> = new Map(),
): Record<string, unknown> {
  // Every block name is a global in Retool's real sandbox, including ones that never ran
  // (e.g. the unselected arm of a conditional): their .data reads null-ish rather than
  // throwing a ReferenceError, so joins after a branch can do `x.data || null`.
  return {
    ...Object.fromEntries(allBlockIds.map((id) => [id, { data: null, error: null }])),
    ...Object.fromEntries([...results].map(([id, data]) => [
      id,
      id === triggerId ? { data, headers, error: null } : { data, error: null, metadata: metadata.get(id) ?? null },
    ])),
    retoolContext: { configVars },
  }
}

async function executeJavascript(
  code: string,
  values: Record<string, unknown>,
  selectPath?: (name: string) => void,
): Promise<unknown> {
  const safeRequire = (name: string) => {
    if (name === 'crypto') return requireBuiltin('node:crypto')
    throw new Error(`Workflow mock sandbox blocked require(${JSON.stringify(name)})`)
  }
  const sandbox = vm.createContext({
    ...values,
    require: safeRequire,
    executePathAtMostOnce: (name: unknown) => selectPath?.(String(name)),
    console,
    Buffer,
    URL,
    setTimeout,
    clearTimeout,
  })
  const wrapped = new vm.Script(`(async () => { ${code}\n})()`, { filename: 'workflow-block.js' })
  return await wrapped.runInContext(sandbox, { timeout: 10_000 })
}

function requireBuiltin(name: string): unknown {
  // Keep the sandbox synchronous and narrowly allowlisted without exposing the
  // process or arbitrary package loading to workflow code.
  if (name === 'node:crypto') {
    return {
      createHmac: (...args: Parameters<typeof import('node:crypto').createHmac>) => {
        // eslint-free dynamic access; imported lazily to keep this module ESM.
        return cryptoCreateHmac(...args)
      },
      timingSafeEqual: (...args: Parameters<typeof import('node:crypto').timingSafeEqual>) => {
        return cryptoTimingSafeEqual(...args)
      },
    }
  }
  throw new Error(`Unsupported builtin ${name}`)
}

function renderExpression(expression: string, values: Record<string, unknown>): unknown {
  const sandbox = vm.createContext({ ...values, Buffer, URL })
  const script = new vm.Script(`(${expression})`, { filename: 'workflow-template.js' })
  return script.runInContext(sandbox, { timeout: 10_000 })
}

function renderTemplate(value: unknown, values: Record<string, unknown>): unknown {
  if (typeof value !== 'string') return value
  const exact = value.match(/^\s*{{([\s\S]+)}}\s*$/)
  if (exact) return renderExpression(exact[1], values)
  return value.replace(/{{([\s\S]*?)}}/g, (_match, expression) => String(renderExpression(expression, values) ?? ''))
}

function renderedRequest(block: WorkflowBlock, values: Record<string, unknown>): unknown {
  // Rendering fails closed: a template that would throw in Retool fails the block here too,
  // even though the resource itself is mocked.
  const operation = operationFor(block)
  if (operation === 'sql') return { sql: renderTemplate(String(block.template?.query ?? ''), values) }
  if (operation !== 'rest') return undefined
  const params = block.template?.openAPIParams
  return {
    method: String(block.template?.type ?? 'GET').toUpperCase(),
    path: renderTemplate(String(block.template?.query ?? ''), values),
    ...(params && params !== '{}' ? { params: renderTemplate(String(params), values) } : {}),
    ...(block.template?.body ? { body: renderTemplate(String(block.template.body), values) } : {}),
  }
}

function fixtureResult(fixture: WorkflowFixture, block: WorkflowBlock): unknown {
  if (!Object.prototype.hasOwnProperty.call(fixture.blocks ?? {}, block.id)) {
    throw new Error(`No mock result configured for resource block ${block.id}`)
  }
  return fixture.blocks![block.id]!.result
}

type OutgoingEdge = { target: WorkflowBlock; portId?: string }

function outgoingEdges(workflow: WorkflowDefinition): Map<string, OutgoingEdge[]> {
  const edges = new Map<string, OutgoingEdge[]>()
  const add = (sourceUuid: string, edge: OutgoingEdge) => edges.set(sourceUuid, [...(edges.get(sourceUuid) ?? []), edge])
  for (const target of workflow.blocks) {
    for (const sourceUuid of target.blockData.incomingOnSuccessEdges ?? []) add(sourceUuid, { target })
    for (const incoming of target.blockData.incomingPorts ?? []) add(incoming.blockId, { target, portId: incoming.portId })
  }
  return edges
}

async function createDocker(fixture: WorkflowFixture, fixturePath?: string): Promise<DisposablePostgres> {
  const base = fixturePath ? dirname(resolve(fixturePath)) : process.cwd()
  const read = (paths?: string[]) => (paths ?? []).map((path) => readFileSync(resolve(base, path), 'utf8'))
  return await createDisposablePostgres({
    schemaSql: read(fixture.postgres?.schema),
    seedSql: read(fixture.postgres?.seed),
    namePrefix: 'retool-workflow',
  })
}

export async function runWorkflow(options: {
  workflow: WorkflowDefinition
  mode: 'mock' | 'docker'
  fixture: WorkflowFixture
  fixturePath?: string
  /** @internal Dependency injection for deterministic tests. */
  databaseFactory?: (fixture: WorkflowFixture, fixturePath?: string) => Promise<DisposablePostgres>
}): Promise<WorkflowRunResult> {
  const { workflow, mode, fixture } = options
  const plan = planWorkflow(workflow)
  if (plan.errors.length) throw new Error(`Invalid workflow:\n${plan.errors.join('\n')}`)
  const start = workflow.blocks.find((block) => operationFor(block) === 'trigger')!
  const edges = outgoingEdges(workflow)
  const results = new Map<string, unknown>()
  const metadata = new Map<string, unknown>()
  const runs: WorkflowBlockRun[] = []
  const completed = new Set<string>()
  const queued = new Set<string>()
  let response: WorkflowRunResult['response']
  let database: DisposablePostgres | undefined
  if (mode === 'docker') database = await (options.databaseFactory ?? createDocker)(fixture, options.fixturePath)

  // Per Retool's actual join semantics: a join waits for all of its listed predecessors
  // "that actually run" — predecessors stranded on a conditional arm that was NOT selected
  // never run at all, so they drop out of the wait set instead of blocking it forever.
  // cutPorts tracks, per conditional block uuid, which of its outgoingPorts were NOT chosen.
  const cutPorts = new Map<string, Set<string>>()
  const deadIds = (): Set<string> => {
    const reachable = new Set<string>([start.id])
    const queue: WorkflowBlock[] = [start]
    while (queue.length) {
      const current = queue.shift()!
      for (const edge of edges.get(current.blockData.uuid) ?? []) {
        if (reachable.has(edge.target.id)) continue
        if (edge.portId !== undefined && cutPorts.get(current.blockData.uuid)?.has(edge.portId)) continue
        reachable.add(edge.target.id)
        queue.push(edge.target)
      }
    }
    return new Set(workflow.blocks.filter((block) => !reachable.has(block.id)).map((block) => block.id))
  }

  const enqueueFrom = (source: WorkflowBlock, selectedPort?: string): WorkflowBlock[] => {
    const selectedPortId = selectedPort === undefined
      ? undefined
      : source.blockData.outgoingPorts?.find((port) => port.name === selectedPort)?.id
    if (selectedPortId !== undefined) {
      const allPortIds = (source.blockData.outgoingPorts ?? []).map((port) => port.id)
      cutPorts.set(source.blockData.uuid, new Set(allPortIds.filter((id) => id !== selectedPortId)))
    }
    const dead = deadIds()
    return (edges.get(source.blockData.uuid) ?? [])
      .filter((edge) => edge.portId === undefined || edge.portId === selectedPortId)
      .map((edge) => edge.target)
      .filter((target) => !queued.has(target.id) && !completed.has(target.id))
      .filter((target) => {
        const sourceUuids = target.blockData.incomingOnSuccessEdges ?? []
        return sourceUuids.every((uuid) => {
          const id = workflow.byUuid.get(uuid)?.id ?? ''
          return completed.has(id) || dead.has(id)
        })
      })
  }

  try {
    results.set(start.id, fixture.trigger ?? {})
    completed.add(start.id)
    runs.push({ id: start.id, status: 'success', durationMs: 0, data: fixture.trigger ?? {} })
    let ready = enqueueFrom(start)
    ready.forEach((block) => queued.add(block.id))

    while (ready.length) {
      const next: WorkflowBlock[] = []
      for (const block of ready) {
        const started = Date.now()
        let selectedPath: string | undefined
        try {
          const operation = operationFor(block)
          const values = contextValues(workflow.blocks.map((b) => b.id), results, fixture.configVars ?? {}, start.id, fixture.headers ?? {}, metadata)
          let data: unknown
          let request: unknown
          if (operation === 'code' || operation === 'condition') {
            data = await executeJavascript(String(block.template?.query ?? ''), values, (path) => { selectedPath = path })
          } else if (operation === 'response') {
            const rawStatus = renderTemplate(block.blockData.options?.status ?? 200, values)
            const rawBody = renderTemplate(block.blockData.options?.body ?? null, values)
            const status = Number(rawStatus)
            let body = rawBody
            if (typeof rawBody === 'string') {
              try { body = renderExpression(rawBody, values) } catch { /* return literal text */ }
            }
            response = { status: Number.isInteger(status) ? status : 200, body }
            data = response
          } else if (operation === 'sql' && mode === 'docker') {
            const sql = String(renderTemplate(block.template?.query ?? '', values))
            request = { sql }
            data = await database!.runSql(sql)
          } else {
            request = renderedRequest(block, values)
            data = fixtureResult(fixture, block)
            const mocked = fixture.blocks![block.id]!
            if (mocked.metadata !== undefined) metadata.set(block.id, mocked.metadata)
          }
          results.set(block.id, data)
          completed.add(block.id)
          runs.push({ id: block.id, status: 'success', durationMs: Date.now() - started, data, ...(selectedPath ? { selectedPath } : {}), ...(request !== undefined ? { request } : {}) })
          for (const target of enqueueFrom(block, selectedPath)) {
            queued.add(target.id)
            next.push(target)
          }
        } catch (error) {
          runs.push({
            id: block.id,
            status: 'failed',
            durationMs: Date.now() - started,
            error: String((error as Error)?.message ?? error),
          })
          return { mode, workflowId: workflow.id, status: 'failed', response, blocks: runs }
        }
      }
      ready = next
    }
    return { mode, workflowId: workflow.id, status: 'success', response, blocks: runs }
  } finally {
    await database?.close()
  }
}
